const crypto = require("node:crypto");

function sameToken(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function csrfProtection(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  if (!sameToken(req.session?.csrfToken, req.get("x-csrf-token"))) {
    return res.status(403).json({ error: "Security token is missing or expired." });
  }
  return next();
}

function requireAuthentication(authService) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required." });
      }

      const user = await authService.getUser(userId);
      if (!user) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          return res.status(401).json({ error: "Authentication required." });
        });
      }

      // Keep the original handler identity shape while API routes are ported.
      req.user = { id: user.id, email: user.email };
      req.auth = { userId: user.id, email: user.email };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { csrfProtection, requireAuthentication, sameToken };
