function readInteger(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function loadConfig(env = process.env) {
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }

  const nodeEnv = env.NODE_ENV || "development";
  const trustProxyDefault = nodeEnv === "production" ? 1 : 0;

  return {
    nodeEnv,
    sessionSecret,
    sessionMaxAgeSeconds: readInteger(
      env,
      "SESSION_MAX_AGE_SECONDS",
      604_800,
      300,
      2_592_000,
    ),
    authCodePepper: env.AUTH_CODE_PEPPER || null,
    authCodeTtlSeconds: readInteger(env, "AUTH_CODE_TTL_SECONDS", 600, 60, 1800),
    authCodeMaxAttempts: readInteger(
      env,
      "AUTH_CODE_MAX_ATTEMPTS",
      5,
      1,
      10,
    ),
    authRateLimitWindowSeconds: readInteger(
      env,
      "AUTH_RATE_LIMIT_WINDOW_SECONDS",
      900,
      60,
      86_400,
    ),
    authRequestLimitPerEmail: readInteger(
      env,
      "AUTH_REQUEST_LIMIT_PER_EMAIL",
      3,
      1,
      20,
    ),
    authRequestLimitPerIp: readInteger(
      env,
      "AUTH_REQUEST_LIMIT_PER_IP",
      30,
      1,
      500,
    ),
    authVerifyLimitPerEmail: readInteger(
      env,
      "AUTH_VERIFY_LIMIT_PER_EMAIL",
      10,
      1,
      100,
    ),
    authVerifyLimitPerIp: readInteger(
      env,
      "AUTH_VERIFY_LIMIT_PER_IP",
      60,
      1,
      1000,
    ),
    trustProxyHops: readInteger(
      env,
      "TRUST_PROXY_HOPS",
      trustProxyDefault,
      0,
      5,
    ),
    resendApiKey: env.RESEND_API_KEY || null,
    emailFrom: env.EMAIL_FROM || null,
  };
}

module.exports = { loadConfig, readInteger };
