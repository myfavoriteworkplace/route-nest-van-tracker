const { HttpError, requireInteger, requireText } = require("./errors");

function context(req) {
  return {
    auth: req.auth,
    config: req.app.locals.config,
    pool: req.app.locals.pool,
    tenant: req.app.locals.tenant,
  };
}

function schoolId(value) {
  return requireInteger(value, "school_id");
}

function validEmail(value, label = "Email address") {
  const email = String(value || "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, `${label} is invalid.`, "invalid_email");
  }
  return email;
}

function requireMembership(tenant, userId, schoolIdValue, roles, res) {
  return tenant
    .requireSchoolRole(userId, schoolIdValue, roles)
    .then((check) => {
      if (check.error) {
        res.status(check.status || 403).json({ error: check.error });
        return null;
      }
      return check.membership;
    });
}

function requiredText(value, label, maxLength) {
  return requireText(value, label, { maxLength });
}

module.exports = {
  context,
  requiredText,
  schoolId,
  validEmail,
  requireMembership,
  HttpError,
  requireInteger,
};
