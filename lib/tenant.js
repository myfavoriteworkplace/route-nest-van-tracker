function createTenantService(pool) {
  if (!pool) throw new Error("An application PostgreSQL pool is required.");

  async function isPlatformAdmin(userId) {
    const result = await pool.query(
      "SELECT user_id FROM platform_admins WHERE user_id = $1",
      [String(userId)],
    );
    return result.rows.length > 0;
  }

  async function membershipsFor(userId) {
    const result = await pool.query(
      `SELECT m.school_id,m.role,m.status,s.name AS school_name,
              s.slug AS school_slug,s.status AS school_status,
              sub.status AS subscription_status,sub.trial_ends_at,
              sub.current_period_end,sub.cancel_at_period_end,
              p.name AS plan_name
         FROM school_memberships m
         JOIN schools s ON s.id=m.school_id
         LEFT JOIN LATERAL (
           SELECT * FROM subscriptions x
            WHERE x.school_id=s.id
            ORDER BY x.updated_at DESC,x.id DESC
            LIMIT 1
         ) sub ON true
         LEFT JOIN plans p ON p.id=sub.plan_id
        WHERE m.user_id=$1 AND m.status='active'
        ORDER BY m.created_at ASC`,
      [String(userId)],
    );
    return result.rows;
  }

  async function writeAudit({
    schoolId = null,
    actorUserId,
    action,
    targetType,
    targetId = null,
    details = {},
    client = pool,
  }) {
    await client.query(
      `INSERT INTO audit_logs
         (school_id,actor_user_id,action,target_type,target_id,details)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        schoolId,
        String(actorUserId),
        action,
        targetType,
        targetId === null ? null : String(targetId),
        JSON.stringify(details),
      ],
    );
  }

  async function requireSchoolRole(userId, schoolId, roles = [], options = {}) {
    const result = await pool.query(
      `SELECT m.school_id,m.role,m.status,s.status AS school_status,
              sub.status AS subscription_status,sub.trial_ends_at,
              sub.current_period_end,sub.updated_at AS subscription_updated_at
         FROM school_memberships m
         JOIN schools s ON s.id=m.school_id
         LEFT JOIN LATERAL (
           SELECT * FROM subscriptions x
            WHERE x.school_id=s.id
            ORDER BY x.updated_at DESC,x.id DESC
            LIMIT 1
         ) sub ON true
        WHERE m.user_id=$1 AND m.school_id=$2 AND m.status='active'
        LIMIT 1`,
      [String(userId), Number(schoolId)],
    );
    const membership = result.rows[0];

    if (!membership) {
      return { error: "You do not have access to this school.", status: 403 };
    }
    if (membership.school_status !== "active") {
      return { error: "This school account is not active.", status: 403 };
    }
    if (roles.length && !roles.includes(membership.role)) {
      return { error: "Your role cannot perform this action.", status: 403 };
    }
    if (options.allowBilling === true) return { membership };

    const subscriptionStatus = membership.subscription_status;
    if (["suspended", "expired"].includes(subscriptionStatus)) {
      return {
        error: "This school subscription is not active. Please review billing.",
        status: 402,
      };
    }
    if (
      subscriptionStatus === "cancelled" &&
      !(
        membership.current_period_end &&
        new Date(membership.current_period_end).getTime() > Date.now()
      )
    ) {
      return {
        error: "This school subscription is not active. Please review billing.",
        status: 402,
      };
    }
    if (
      subscriptionStatus === "past_due" &&
      membership.subscription_updated_at &&
      Date.now() - new Date(membership.subscription_updated_at).getTime() >
        7 * 86_400_000
    ) {
      return {
        error: "The subscription grace period has ended. Please update billing.",
        status: 402,
      };
    }
    if (
      subscriptionStatus === "trialing" &&
      membership.trial_ends_at &&
      new Date(membership.trial_ends_at).getTime() < Date.now()
    ) {
      return {
        error: "The school trial has ended. Please review subscription billing.",
        status: 402,
      };
    }

    return { membership };
  }

  return { isPlatformAdmin, membershipsFor, requireSchoolRole, writeAudit };
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "school"
  );
}

module.exports = { createTenantService, slugify };
