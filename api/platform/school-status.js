const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  if (!(await tenant.isPlatformAdmin(auth.userId))) {
    throw new HttpError(403, "Platform Super Admin access required.", "platform_admin_required");
  }

  const schoolId = parseSchoolId(req.body?.school_id);
  const status = String(req.body?.status || "");
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (!["active", "suspended", "archived"].includes(status)) {
    throw new HttpError(400, "A valid school status is required.", "invalid_status");
  }

  const school = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE schools SET status=$1,updated_at=now()
        WHERE id=$2
        RETURNING id,name,status`,
      [status, schoolId],
    );
    if (!result.rows.length) {
      throw new HttpError(404, "School not found.", "school_not_found");
    }
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: "school.status_changed",
      targetType: "school",
      targetId: schoolId,
      details: { status, reason },
    });
    return result.rows[0];
  });
  return res.json({ school });
}

module.exports = { methods: ["POST"], handler };
