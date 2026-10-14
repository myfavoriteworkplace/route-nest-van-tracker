const crypto = require("node:crypto");

class RazorpayError extends Error {
  constructor(code = "razorpay_unavailable") {
    super("Razorpay request could not be completed.");
    this.name = "RazorpayError";
    this.code = code;
  }
}

function requireRazorpayCredentials(config) {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new RazorpayError("razorpay_not_configured");
  }
}

async function razorpayRequest(
  { config, method = "GET", path, body, fetchImpl = fetch },
) {
  requireRazorpayCredentials(config);
  let response;
  try {
    response = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.razorpayKeyId}:${config.razorpayKeySecret}`,
        ).toString("base64")}`,
        "Content-Type": "application/json",
        "User-Agent": "RouteNest/1.0",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RazorpayError();
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new RazorpayError();
  }
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new RazorpayError();
  }
  return payload;
}

async function verifyRecurringPlan({ config, planId, interval, amountPaise, fetchImpl }) {
  if (!/^plan_[A-Za-z0-9]+$/.test(planId)) {
    return { valid: false, reason: "plan_id_format" };
  }
  let plan;
  try {
    plan = await razorpayRequest({
      config,
      method: "GET",
      path: `/plans/${encodeURIComponent(planId)}`,
      fetchImpl,
    });
  } catch (error) {
    throw error;
  }

  const planInterval = Number(plan.interval);
  const periodMatches =
    interval === "monthly"
      ? plan.period === "monthly" && planInterval === 1
      : (plan.period === "yearly" && planInterval === 1) ||
        (plan.period === "monthly" && planInterval === 12);
  const planAmount = Number(plan.item?.amount ?? plan.item?.unit_amount);
  return {
    valid:
      plan.id === planId &&
      periodMatches &&
      Number.isSafeInteger(planAmount) &&
      planAmount === amountPaise &&
      String(plan.item?.currency || "").toUpperCase() === "INR" &&
      plan.item?.active !== false,
    reason: "plan_mismatch",
  };
}

function verifyHmac({ raw, signature, secret }) {
  if (
    !Buffer.isBuffer(raw) ||
    typeof secret !== "string" ||
    !secret ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(raw).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

function verifyCheckoutSignature({
  paymentId,
  subscriptionId,
  signature,
  secret,
}) {
  if (
    typeof paymentId !== "string" ||
    typeof subscriptionId !== "string" ||
    typeof secret !== "string" ||
    !secret ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

module.exports = {
  RazorpayError,
  razorpayRequest,
  verifyCheckoutSignature,
  verifyHmac,
  verifyRecurringPlan,
};
