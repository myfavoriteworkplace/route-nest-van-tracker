const crypto = require("node:crypto");
const { withTransaction } = require("../../server/database");
const { consumeRateLimit } = require("../../server/auth-service");
const { context, HttpError } = require("../../server/api-utils");
const { sameToken } = require("../../server/security");

async function handler(req, res) {
  const { auth, config, pool, tenant } = context(req);
  const supplied = String(req.body?.bootstrap_key || "");
  const expected = config.platformBootstrapKey;
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) {
    throw new HttpError(503, "Platform bootstrap is not configured.", "bootstrap_not_configured");
  }
  if (!supplied) {
    throw new HttpError(400, "Bootstrap key is required.", "bootstrap_key_required");
  }

  const allowed = await consumeRateLimit(
    pool,
    `bootstrap-ip:${req.ip || "unknown"}`,
    5,
    3600,
    expected,
  );
  if (!allowed) {
    throw new HttpError(429, "Too many bootstrap attempts. Try again later.", "rate_limited");
  }
  if (!sameToken(expected, supplied)) {
    throw new HttpError(403, "Bootstrap key is invalid.", "invalid_bootstrap_key");
  }

  await withTransaction(pool, async (client) => {
    const user = await client.query(
      `SELECT id FROM app_users
        WHERE id=$1 AND status='active' AND email_verified_at IS NOT NULL
        FOR UPDATE`,
      [auth.userId],
    );
    if (!user.rows.length) {
      throw new HttpError(403, "An active verified account is required.", "account_not_verified");
    }

    const inserted = await client.query(
      `INSERT INTO platform_admins (user_id,created_by)
       VALUES ($1,$1)
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [auth.userId],
    );
    if (!inserted.rows.length) {
      throw new HttpError(
        409,
        "A platform Super Admin has already been configured. Ask an existing platform administrator.",
        "platform_admin_exists",
      );
    }
    await tenant.writeAudit({
      client,
      actorUserId: auth.userId,
      action: "platform.super_admin_bootstrapped",
      targetType: "platform_admin",
      targetId: auth.userId,
      details: { bootstrap_id: crypto.randomUUID() },
    });
  });

  return res.json({
    ok: true,
    message: "This account is now the initial platform Super Admin.",
  });
}

module.exports = { methods: ["POST"], handler };
