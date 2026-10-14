const { withTransaction } = require("../../server/database");
const { context, HttpError } = require("../../server/api-utils");
const { verifyHmac } = require("../../server/razorpay");

const subscriptionStatuses = {
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.authenticated": "active",
  "subscription.pending": "pending",
  "subscription.halted": "past_due",
  "subscription.paused": "past_due",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "expired",
  "payment.failed": "past_due",
};

function timestampFromSeconds(value) {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function handler(req, res) {
  const { config, pool } = context(req);
  const signature = req.get("x-razorpay-signature");
  const eventId = String(req.get("x-razorpay-event-id") || "");
  if (!config.razorpayWebhookSecret) {
    throw new HttpError(503, "Razorpay webhook verification is not configured.", "webhook_not_configured");
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody) || !signature) {
    throw new HttpError(400, "Webhook signature or raw payload is missing.", "webhook_invalid");
  }
  if (!verifyHmac({ raw: req.rawBody, signature, secret: config.razorpayWebhookSecret })) {
    throw new HttpError(401, "Invalid webhook signature.", "invalid_webhook_signature");
  }
  if (!eventId || eventId.length > 255) {
    throw new HttpError(400, "Webhook event identifier is missing or invalid.", "webhook_invalid");
  }

  let event;
  try {
    event = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid webhook JSON payload.", "webhook_invalid");
  }
  const eventType = String(event.event || "");
  if (!eventType || eventType.length > 100) {
    throw new HttpError(400, "Webhook event type is missing or invalid.", "webhook_invalid");
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO webhook_events (provider_event_id,event_type,status)
         VALUES ($1,$2,'received')
         ON CONFLICT (provider_event_id) DO NOTHING
         RETURNING id`,
        [eventId, eventType],
      );
      if (!inserted.rows.length) {
        const previous = await client.query(
          `SELECT status FROM webhook_events
            WHERE provider_event_id=$1 FOR UPDATE`,
          [eventId],
        );
        if (["processed", "ignored"].includes(previous.rows[0]?.status)) {
          return { duplicate: true };
        }
        await client.query(
          `UPDATE webhook_events
              SET status='received',event_type=$2,error_summary=NULL
            WHERE provider_event_id=$1`,
          [eventId, eventType],
        );
      }

      const subscriptionEntity = event.payload?.subscription?.entity || {};
      const payment = event.payload?.payment?.entity || {};
      const subscriptionId = String(
        subscriptionEntity.id || payment.subscription_id || "",
      );
      const subscriptionResult = subscriptionId
        ? await client.query(
            `SELECT id,school_id,status,provider_event_created_at
               FROM subscriptions
              WHERE provider_subscription_id=$1
              FOR UPDATE`,
            [subscriptionId],
          )
        : { rows: [] };
      const subscription = subscriptionResult.rows[0] || null;
      const nextStatus = subscriptionStatuses[eventType];
      const eventCreatedAt =
        Number.isSafeInteger(Number(event.created_at)) && Number(event.created_at) > 0
          ? Number(event.created_at)
          : Math.floor(Date.now() / 1000);

      if (subscription && nextStatus) {
        const start = timestampFromSeconds(subscriptionEntity.current_start);
        const end = timestampFromSeconds(subscriptionEntity.current_end);
        await client.query(
          `UPDATE subscriptions
              SET status=CASE
                    WHEN provider_event_created_at IS NULL
                      OR provider_event_created_at <= $2
                    THEN $3 ELSE status END,
                  current_period_start=CASE
                    WHEN provider_event_created_at IS NULL
                      OR provider_event_created_at <= $2
                    THEN COALESCE($4,current_period_start)
                    ELSE current_period_start END,
                  current_period_end=CASE
                    WHEN provider_event_created_at IS NULL
                      OR provider_event_created_at <= $2
                    THEN COALESCE($5,current_period_end)
                    ELSE current_period_end END,
                  provider_event_created_at=GREATEST(
                    COALESCE(provider_event_created_at,$2),$2
                  ),
                  updated_at=now()
            WHERE id=$1`,
          [subscription.id, eventCreatedAt, nextStatus, start, end],
        );
      }

      if (payment.id) {
        const amount = Number(payment.amount || 0);
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) {
          throw new Error("invalid_payment_amount");
        }
        const currency = String(payment.currency || "INR").toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
          throw new Error("invalid_payment_currency");
        }
        const paidAt = timestampFromSeconds(payment.created_at);
        const schoolId = subscription?.school_id || null;
        await client.query(
          `INSERT INTO payment_events
             (school_id,subscription_id,provider_payment_id,provider_event_id,
              amount_paise,currency,status,paid_at,raw_summary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT (provider_payment_id) DO UPDATE
             SET school_id=COALESCE(EXCLUDED.school_id,payment_events.school_id),
                 subscription_id=COALESCE(EXCLUDED.subscription_id,payment_events.subscription_id),
                 provider_event_id=EXCLUDED.provider_event_id,
                 amount_paise=EXCLUDED.amount_paise,currency=EXCLUDED.currency,
                 status=EXCLUDED.status,paid_at=COALESCE(EXCLUDED.paid_at,payment_events.paid_at),
                 raw_summary=EXCLUDED.raw_summary`,
          [
            schoolId,
            subscription?.id || null,
            String(payment.id),
            eventId,
            amount,
            currency,
            String(payment.status || eventType).slice(0, 40),
            paidAt,
            JSON.stringify({
              event: eventType,
              invoice_id: String(payment.invoice_id || "").slice(0, 100) || null,
            }),
          ],
        );
      }

      const isRecognized = Boolean(nextStatus || payment.id);
      await client.query(
        `UPDATE webhook_events
            SET status=$2,processed_at=now(),error_summary=NULL
          WHERE provider_event_id=$1`,
        [eventId, isRecognized ? "processed" : "ignored"],
      );
      return { duplicate: false, processed: isRecognized };
    });

    if (result.duplicate) {
      return res.json({ received: true, duplicate: true });
    }
    return res.json({ received: true, processed: result.processed });
  } catch (error) {
    await pool
      .query(
        `INSERT INTO webhook_events (provider_event_id,event_type,status,error_summary)
         VALUES ($1,$2,'failed','processing_failed')
         ON CONFLICT (provider_event_id) DO UPDATE
           SET status='failed',error_summary='processing_failed'`,
        [eventId, eventType],
      )
      .catch(() => {});
    console.error(
      JSON.stringify({
        event: "razorpay_webhook_failed",
        eventId,
        code: error.code || "processing_failed",
      }),
    );
    return res.status(500).json({ error: "Webhook processing failed; retry is safe." });
  }
}

module.exports = { access: "public", methods: ["POST"], handler };
