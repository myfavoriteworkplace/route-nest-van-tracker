const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");
const { RazorpayError, razorpayRequest } = require("../../server/razorpay");

function providerCheckoutUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      (url.hostname === "rzp.io" ||
        url.hostname === "razorpay.com" ||
        url.hostname.endsWith(".razorpay.com"))
    ) {
      return url.toString();
    }
  } catch {}
  return null;
}

async function handler(req, res) {
  const { auth, config, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.body?.school_id);
  const interval = String(req.body?.interval || "monthly");
  if (!["monthly", "annual"].includes(interval)) {
    throw new HttpError(400, "A valid billing interval is required.", "invalid_interval");
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
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new HttpError(503, "Razorpay API credentials are not configured.", "razorpay_not_configured");
  }

  const subscription = await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('billing-checkout'),hashtext($1))", [
      String(schoolId),
    ]);
    const existing = await client.query(
      `SELECT id,status,provider_subscription_id
         FROM subscriptions
        WHERE school_id=$1
          AND status IN ('pending','active','past_due','trialing')
        ORDER BY id DESC LIMIT 1
        FOR UPDATE`,
      [schoolId],
    );
    const prior = existing.rows[0];
    if (prior?.status === "active") {
      throw new HttpError(409, "This school already has an active subscription.", "subscription_active");
    }
    if (prior?.provider_subscription_id) {
      throw new HttpError(
        409,
        "A Razorpay subscription is already pending. Complete that checkout or reconcile it before creating another.",
        "subscription_pending",
      );
    }

    const planResult = await client.query(
      `SELECT id,name,monthly_price_paise,annual_price_paise,
              provider_plan_id,provider_annual_plan_id
         FROM plans
        WHERE code='school-standard' AND active=true
        LIMIT 1`,
    );
    const plan = planResult.rows[0];
    const providerPlanId =
      interval === "annual"
        ? plan?.provider_annual_plan_id
        : plan?.provider_plan_id;
    if (!plan || !providerPlanId) {
      throw new HttpError(
        503,
        "Billing is not configured. The platform owner must verify the matching recurring plans in Razorpay.",
        "billing_not_configured",
      );
    }

    let providerSubscription;
    try {
      providerSubscription = await razorpayRequest({
        config,
        method: "POST",
        path: "/subscriptions",
        body: {
          plan_id: providerPlanId,
          total_count: interval === "annual" ? 10 : 120,
          customer_notify: true,
          quantity: 1,
          notes: {
            school_id: String(schoolId),
            created_by: String(auth.userId),
            billing_interval: interval,
          },
        },
      });
    } catch (error) {
      if (error instanceof RazorpayError && error.code === "razorpay_not_configured") {
        throw new HttpError(503, "Razorpay API credentials are not configured.", error.code);
      }
      throw new HttpError(502, "Razorpay could not create the subscription.", "razorpay_unavailable");
    }

    const checkoutUrl = providerCheckoutUrl(providerSubscription.short_url);
    if (
      !/^sub_[A-Za-z0-9]+$/.test(String(providerSubscription.id || "")) ||
      !checkoutUrl
    ) {
      throw new HttpError(502, "Razorpay returned an invalid subscription response.", "razorpay_invalid_response");
    }

    let result;
    if (prior) {
      result = await client.query(
        `UPDATE subscriptions
            SET status='pending',provider_subscription_id=$1,
                billing_interval=$2,provider_plan_id=$3,updated_at=now()
          WHERE id=$4
          RETURNING id,provider_subscription_id,status,billing_interval`,
        [providerSubscription.id, interval, providerPlanId, prior.id],
      );
    } else {
      result = await client.query(
        `INSERT INTO subscriptions
           (school_id,plan_id,status,provider_subscription_id,billing_interval)
         VALUES ($1,$2,'pending',$3,$4)
         RETURNING id,provider_subscription_id,status,billing_interval`,
        [schoolId, plan.id, providerSubscription.id, interval],
      );
    }
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: "subscription.checkout_created",
      targetType: "subscription",
      targetId: providerSubscription.id,
      details: { interval },
    });
    return {
      subscription: result.rows[0],
      checkoutUrl,
      planName: plan.name,
      amountPaise:
        interval === "annual"
          ? plan.annual_price_paise
          : plan.monthly_price_paise,
      providerStatus: String(providerSubscription.status || "created"),
    };
  });

  return res.status(201).json({
    subscription_id: subscription.subscription.provider_subscription_id,
    key_id: config.razorpayKeyId,
    short_url: subscription.checkoutUrl,
    checkout_url: subscription.checkoutUrl,
    status: subscription.providerStatus,
    plan: subscription.planName,
    amount_paise: subscription.amountPaise,
  });
}

module.exports = { methods: ["POST"], handler };
