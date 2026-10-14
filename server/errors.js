class HttpError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

function requireInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label} must be a valid integer.`, "invalid_input");
  }
  return number;
}

function requireText(value, label, { maxLength = 200, minLength = 1 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new HttpError(400, `${label} is required.`, "invalid_input");
  }
  return text;
}

function sendTenantError(res, result) {
  if (result?.error) {
    res.status(result.status || 403).json({ error: result.error });
    return true;
  }
  return false;
}

module.exports = { HttpError, requireInteger, requireText, sendTenantError };
