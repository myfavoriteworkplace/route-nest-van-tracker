const { context, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  if (!(await tenant.isPlatformAdmin(auth.userId))) {
    throw new HttpError(403, "Platform Super Admin access required.", "platform_admin_required");
  }

  const [metrics, schools, activity] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT count(*) FROM schools) AS total_schools,
         (SELECT count(*) FROM schools WHERE status='active') AS active_schools,
         (SELECT count(*) FROM subscriptions
           WHERE status='trialing' AND trial_ends_at>now()) AS trials,
         (SELECT count(*) FROM subscriptions WHERE status='active') AS active_subscriptions,
         (SELECT count(*) FROM subscriptions WHERE status='past_due') AS past_due,
         (SELECT COALESCE(sum(
           CASE WHEN billing_interval='monthly'
             THEN p.monthly_price_paise
             ELSE p.annual_price_paise/12
           END
         ),0)
           FROM subscriptions s JOIN plans p ON p.id=s.plan_id
          WHERE s.status='active') AS mrr_paise,
         (SELECT count(*) FROM webhook_events WHERE status='failed') AS failed_webhooks`,
    ),
    pool.query(
      `SELECT s.id,s.name,s.slug,s.contact_email,s.status,s.created_at,
              sub.status AS subscription_status,sub.trial_ends_at,
              sub.current_period_end,p.name AS plan_name
         FROM schools s
         LEFT JOIN LATERAL (
           SELECT * FROM subscriptions x
            WHERE x.school_id=s.id
              AND x.status IN ('trialing','pending','active','past_due','suspended')
            ORDER BY x.updated_at DESC,x.id DESC LIMIT 1
         ) sub ON true
         LEFT JOIN plans p ON p.id=sub.plan_id
        ORDER BY s.created_at DESC
        LIMIT 100`,
    ),
    pool.query(
      `SELECT id,action,target_type,target_id,actor_user_id,created_at
         FROM audit_logs ORDER BY created_at DESC LIMIT 20`,
    ),
  ]);
  return res.json({
    metrics: metrics.rows[0],
    schools: schools.rows,
    recent_activity: activity.rows,
  });
}

module.exports = { methods: ["GET"], handler };
