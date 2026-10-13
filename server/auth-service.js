const crypto = require("node:crypto");
const { sendLoginCode } = require("./email");

const INVALID_CODE_MESSAGE = "That code is invalid, expired, or already used.";
let nextCleanupAt = 0;

class AuthError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AuthError("Enter a valid email address.", 400, "invalid_email");
  }
  return email;
}

function hashLoginCode(email, code, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(`${email}\0${code}`)
    .digest("hex");
}

function hashRateLimitKey(key, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(`rate-limit\0${key}`)
    .digest("hex");
}

function constantTimeHashMatch(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    !/^[a-f0-9]{64}$/.test(left) ||
    !/^[a-f0-9]{64}$/.test(right)
  ) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function requireCodePepper(config) {
  if (
    !config.authCodePepper ||
    Buffer.byteLength(config.authCodePepper, "utf8") < 32
  ) {
    throw new AuthError(
      "Sign-in is temporarily unavailable. Please try again later.",
      503,
      "auth_not_configured",
    );
  }
}

async function consumeRateLimit(pool, key, limit, windowSeconds, pepper) {
  const bucketHash = hashRateLimitKey(key, pepper);
  const result = await pool.query(
    `INSERT INTO auth_rate_limits
       (bucket_hash, window_started_at, attempts, updated_at)
     VALUES ($1, now(), 1, now())
     ON CONFLICT (bucket_hash) DO UPDATE
       SET window_started_at = CASE
             WHEN auth_rate_limits.window_started_at <
                  now() - ($2::integer * interval '1 second')
             THEN now()
             ELSE auth_rate_limits.window_started_at
           END,
           attempts = CASE
             WHEN auth_rate_limits.window_started_at <
                  now() - ($2::integer * interval '1 second')
             THEN 1
             ELSE auth_rate_limits.attempts + 1
           END,
           updated_at = now()
     RETURNING attempts`,
    [bucketHash, windowSeconds],
  );
  return Number(result.rows[0].attempts) <= limit;
}

async function maybePruneAuthRecords(pool) {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60 * 60 * 1000;

  try {
    await pool.query(
      "DELETE FROM auth_login_codes WHERE created_at < now() - interval '1 day'",
    );
    await pool.query(
      "DELETE FROM auth_rate_limits WHERE updated_at < now() - interval '7 days'",
    );
  } catch {
    // Cleanup is best-effort; authentication rate limits remain enforced.
    nextCleanupAt = Date.now() + 5 * 60 * 1000;
  }
}

function invalidCodeError() {
  return new AuthError(INVALID_CODE_MESSAGE, 400, "invalid_code");
}

async function findOrCreateAppUser(client, email) {
  const current = await client.query(
    "SELECT id, email, status FROM app_users WHERE lower(email) = $1 FOR UPDATE",
    [email],
  );

  if (current.rows[0]) {
    if (current.rows[0].status !== "active") throw invalidCodeError();
    return { id: current.rows[0].id, email: current.rows[0].email };
  }

  const profiles = await client.query(
    `SELECT user_id, status
       FROM user_profiles
      WHERE lower(email) = $1
      ORDER BY user_id
      LIMIT 2
      FOR UPDATE`,
    [email],
  );

  if (profiles.rows.length > 1) {
    throw new AuthError(
      "Sign-in could not be completed. Please contact your administrator.",
      409,
      "ambiguous_legacy_identity",
    );
  }

  const legacyProfile = profiles.rows[0];
  if (legacyProfile && legacyProfile.status !== "active") {
    throw invalidCodeError();
  }

  const userId = legacyProfile
    ? legacyProfile.user_id
    : `app_${crypto.randomUUID()}`;

  await client.query(
    `INSERT INTO app_users (id, email, email_verified_at)
     VALUES ($1, $2, now())`,
    [userId, email],
  );

  if (!legacyProfile) {
    await client.query(
      "INSERT INTO user_profiles (user_id, email) VALUES ($1, $2)",
      [userId, email],
    );
  }

  return { id: userId, email };
}

function createAuthService({ pool, config, sendCode = sendLoginCode }) {
  if (!pool) throw new Error("An application PostgreSQL pool is required.");

  async function checkRateLimits(email, ip, emailLimit) {
    requireCodePepper(config);
    await maybePruneAuthRecords(pool);

    const ipAllowed = await consumeRateLimit(
      pool,
      `ip:${ip || "unknown"}`,
      emailLimit.ip,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    if (!ipAllowed) {
      throw new AuthError(
        "Too many attempts. Please wait before trying again.",
        429,
        "rate_limited",
      );
    }

    const emailAllowed = await consumeRateLimit(
      pool,
      `email:${email}`,
      emailLimit.email,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    if (!emailAllowed) {
      throw new AuthError(
        "Too many attempts. Please wait before trying again.",
        429,
        "rate_limited",
      );
    }
  }

  async function requestCode(rawEmail, ip) {
    requireCodePepper(config);
    if (!config.resendApiKey || !config.emailFrom) {
      throw new AuthError(
        "Sign-in email is not configured. Please try again later.",
        503,
        "email_not_configured",
      );
    }

    const ipAllowed = await consumeRateLimit(
      pool,
      `request:ip:${ip || "unknown"}`,
      config.authRequestLimitPerIp,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    if (!ipAllowed) {
      throw new AuthError(
        "Too many attempts. Please wait before trying again.",
        429,
        "rate_limited",
      );
    }

    const email = normalizeEmail(rawEmail);
    const emailAllowed = await consumeRateLimit(
      pool,
      `request:email:${email}`,
      config.authRequestLimitPerEmail,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    if (!emailAllowed) {
      throw new AuthError(
        "Too many attempts. Please wait before trying again.",
        429,
        "rate_limited",
      );
    }

    await maybePruneAuthRecords(pool);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hashLoginCode(email, code, config.authCodePepper);
    const expiresAt = new Date(Date.now() + config.authCodeTtlSeconds * 1000);
    const client = await pool.connect();
    let inTransaction = false;
    let loginCodeId;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      await client.query(
        "UPDATE auth_login_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL",
        [email],
      );
      const inserted = await client.query(
        `INSERT INTO auth_login_codes (email, code_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [email, codeHash, expiresAt],
      );
      loginCodeId = inserted.rows[0].id;
      await client.query("COMMIT");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    try {
      await sendCode({
        to: email,
        code,
        ttlSeconds: config.authCodeTtlSeconds,
        config,
      });
    } catch {
      await pool
        .query(
          "UPDATE auth_login_codes SET consumed_at = now() WHERE id = $1",
          [loginCodeId],
        )
        .catch(() => {});
      throw new AuthError(
        "Sign-in email could not be delivered. Please try again later.",
        503,
        "email_delivery_failed",
      );
    }
  }

  async function verifyCode(rawEmail, rawCode, ip) {
    requireCodePepper(config);
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode || "").trim();

    const ipAllowed = await consumeRateLimit(
      pool,
      `verify:ip:${ip || "unknown"}`,
      config.authVerifyLimitPerIp,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    const emailAllowed = await consumeRateLimit(
      pool,
      `verify:email:${email}`,
      config.authVerifyLimitPerEmail,
      config.authRateLimitWindowSeconds,
      config.authCodePepper,
    );
    if (!ipAllowed || !emailAllowed) {
      throw new AuthError(
        "Too many attempts. Please wait before trying again.",
        429,
        "rate_limited",
      );
    }
    if (!/^\d{6}$/.test(code)) throw invalidCodeError();

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      const result = await client.query(
        `SELECT id, code_hash, attempts, expires_at
           FROM auth_login_codes
          WHERE email = $1 AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [email],
      );
      const loginCode = result.rows[0];

      if (
        !loginCode ||
        new Date(loginCode.expires_at).getTime() <= Date.now() ||
        Number(loginCode.attempts) >= config.authCodeMaxAttempts
      ) {
        if (loginCode) {
          await client.query(
            "UPDATE auth_login_codes SET consumed_at = now() WHERE id = $1",
            [loginCode.id],
          );
        }
        await client.query("COMMIT");
        inTransaction = false;
        throw invalidCodeError();
      }

      const candidateHash = hashLoginCode(email, code, config.authCodePepper);
      if (!constantTimeHashMatch(loginCode.code_hash, candidateHash)) {
        await client.query(
          `UPDATE auth_login_codes
              SET attempts = attempts + 1,
                  consumed_at = CASE
                    WHEN attempts + 1 >= $2 THEN now()
                    ELSE consumed_at
                  END
            WHERE id = $1`,
          [loginCode.id, config.authCodeMaxAttempts],
        );
        await client.query("COMMIT");
        inTransaction = false;
        throw invalidCodeError();
      }

      await client.query(
        "UPDATE auth_login_codes SET consumed_at = now() WHERE id = $1",
        [loginCode.id],
      );
      const user = await findOrCreateAppUser(client, email);
      await client.query("COMMIT");
      inTransaction = false;
      return user;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function getUser(userId) {
    const result = await pool.query(
      "SELECT id, email, status FROM app_users WHERE id = $1",
      [userId],
    );
    const user = result.rows[0];
    if (!user || user.status !== "active") return null;
    return { id: user.id, email: user.email };
  }

  return { getUser, requestCode, verifyCode };
}

module.exports = {
  AuthError,
  constantTimeHashMatch,
  consumeRateLimit,
  createAuthService,
  hashLoginCode,
  normalizeEmail,
};
