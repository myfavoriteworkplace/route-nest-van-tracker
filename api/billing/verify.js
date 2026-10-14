const { withTransaction } = require("../../server/database");
const {
  context,
  schoolId: parseSchoolId,
  HttpError,
} = require("../../server/api-utils");
const {
  RazorpayError,
  razorpayRequest,
  verifyCheckoutSignature,
} = require("../../server/razorpay");

function providerTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function handler(req, res) {
  const { auth, config, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.body?.school_id);
  const requestedSubscriptionId = String(req.body?.subscription_id || "");
  const callbackSubscriptionId = String(req.body?.razorpay_subscription_id || "");
  const paymentId = String(req.body?.razorpay_payment_id || "");
  const signature = String(req.body?.razorpay_signature || "");
  if (
    !/^sub_[A-Za-z0-9]+$/.test(requestedSubscriptionId) ||
    !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
    callbackSubscriptionId !== requestedSubscriptionId
  ) {
    throw new HttpError(400, "Razorpay checkout response is incomplete.", "checkout_response_invalid");
  }

  const access = await tenant.requireSchoolRole(
    auth.userId,
    schoolId,
    ["school_admin"],
    { allowBilling: true },
  );
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const localResult = await pool.query(
    `SELECT s.id,s.school_id,s.status,s.billing_interval,
            s.provider_subscription_id,s.provider_plan_id,p.name AS plan_name
       FROM subscriptions s
       JOIN plans p ON p.id=s.plan_id
      WHERE s.school_id=$1 AND s.provider_subscription_id=$2
      LIMIT 1`,
    [schoolId, requestedSubscriptionId],
  );
  const local = localResult.rows[0];
  if (!local) {
    throw new HttpError(404, "Subscription not found for this school.", "subscription_not_found");
  }
  if (["cancelled", "expired", "suspended"].includes(local.status)) {
    throw new HttpError(409, "This subscription is no longer eligible for checkout verification.", "subscription_closed");
  }
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new HttpError(503, "Razorpay API credentials are not configured.", "razorpay_not_configured");
  }
  if (
    !verifyCheckoutSignature({
      paymentId,
      subscriptionId: local.provider_subscription_id,
      signature,
      secret: config.razorpayKeySecret,
    })
  ) {
    throw new HttpError(401, "Razorpay checkout signature is invalid.", "checkout_signature_invalid");
  }

  let remoteSubscription;
  let remotePayment;
  try {
    [remoteSubscription, remotePayment] = await Promise.all([
      razorpayRequest({
        config,
        method: "GET",
        path: `/subscriptions/${encodeURIComponent(local.provider_subscription_id)}`,
      }),
      razorpayRequest({
        config,
        method: "GET",
        path: `/payments/${encodeURIComponent(paymentId)}`,
      }),
    ]);
  } catch (error) {
    if (error instanceof RazorpayError && error.code === "razorpay_not_configured") {
      throw new HttpError(503, "Razorpay API credentials are not configured.", error.code);
    }
    throw new HttpError(502, "Razorpay could not confirm the checkout.", "razorpay_unavailable");
  }

  const paymentMatches =
    remotePayment.id === paymentId &&
    remotePayment.subscription_id === local.provider_subscription_id &&
    ["captured", "authorized"].includes(String(remotePayment.status || "")) &&
    String(remotePayment.currency || "").toUpperCase() === "INR";
  const subscriptionMatches =
    remoteSubscription.id === local.provider_subscription_id &&
    remoteSubscription.plan_id === local.provider_plan_id &&
    ["active", "authenticated"].includes(String(remoteSubscription.status || ""));
  if (!paymentMatches) {
    throw new HttpError(409, "Razorpay has not confirmed a successful subscription payment.", "payment_not_confirmed");
  }
  if (!subscriptionMatches) {
    return res.status(202).json({
      verified: false,
      status: "pending",
      message: "Payment received. Subscription activation is still being confirmed.",
    });
  }

  const amount = Number(remotePayment.amount || 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) {
    throw new HttpError(502, "Razorpay returned an invalid payment amount.", "razorpay_invalid_response");
  }
  const periodStart = providerTimestamp(remoteSubscription.current_start);
  const periodEnd = providerTimestamp(remoteSubscription.current_end);
  const verificationTime = Math.floor(Date.now() / 1000);

  await withTransaction(pool, async (client) => {
    const current = await client.query(
      `SELECT id,status FROM subscriptions
        WHERE id=$1 AND school_id=$2 AND provider_subscription_id=$3
        FOR UPDATE`,
      [local.id, schoolId, local.provider_subscription_id],
    );
    if (!current.rows.length) {
      throw new HttpError(404, "Subscription not found for this school.", "subscription_not_found");
    }
    if (["cancelled", "expired", "suspended"].includes(current.rows[0].status)) {
      throw new HttpError(409, "This subscription is no longer active.", "subscription_closed");
    }

    await client.query(
      `UPDATE subscriptions
          SET status='active',
              current_period_start=COALESCE($2,current_period_start),
              current_period_end=COALESCE($3,current_period_end),
              provider_event_created_at=GREATEST(
                COALESCE(provider_event_created_at,$4),$4
              ),
              updated_at=now()
        WHERE id=$1`,
      [local.id, periodStart, periodEnd, verificationTime],
    );
    await client.query(
      `INSERT INTO payment_events
         (school_id,subscription_id,provider_payment_id,provider_event_id,
          amount_paise,currency,status,paid_at,raw_summary)
       VALUES ($1,$2,$3,$4,$5,'INR',$6,$7,$8::jsonb)
       ON CONFLICT (provider_payment_id) DO UPDATE
         SET school_id=EXCLUDED.school_id,
             subscription_id=EXCLUDED.subscription_id,
             provider_event_id=COALESCE(
               payment_events.provider_event_id,EXCLUDED.provider_event_id
             ),
             amount_paise=EXCLUDED.amount_paise,currency=EXCLUDED.currency,
             status=EXCLUDED.status,
             paid_at=COALESCE(EXCLUDED.paid_at,payment_events.paid_at),
             raw_summary=EXCLUDED.raw_summary`,
      [
        schoolId,
        local.id,
        paymentId,
        `checkout-verification:${paymentId}`,
        amount,
        String(remotePayment.status).slice(0, 40),
        providerTimestamp(remotePayment.created_at),
        JSON.stringify({ event: "checkout.verified" }),
      ],
    );
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: "subscription.checkout_verified",
      targetType: "subscription",
      targetId: local.provider_subscription_id,
      details: { interval: local.billing_interval },
    });
  });

  return res.json({
    verified: true,
    status: "active",
    plan: local.plan_name,
    message: "Razorpay confirmed the payment and the subscription is active.",
  });
}

module.exports = { methods: ["POST"], handler };
