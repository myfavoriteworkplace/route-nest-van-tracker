class EmailDeliveryError extends Error {
  constructor() {
    super("Sign-in email could not be delivered.");
    this.name = "EmailDeliveryError";
    this.code = "email_delivery_failed";
  }
}

async function sendLoginCode({ to, code, ttlSeconds, config, fetchImpl = fetch }) {
  if (!config.resendApiKey || !config.emailFrom) {
    throw new EmailDeliveryError();
  }

  const expiresInMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  let response;

  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "RouteNest/1.0",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [to],
        subject: "Your RouteNest sign-in code",
        text: `Your RouteNest sign-in code is ${code}. It expires in ${expiresInMinutes} minutes. If you did not request it, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailDeliveryError();
  }

  if (!response.ok) {
    throw new EmailDeliveryError();
  }
}

module.exports = { EmailDeliveryError, sendLoginCode };
