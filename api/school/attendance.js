const { context, schoolId: parseSchoolId } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.query?.school_id);
  const access = await tenant.requireSchoolRole(auth.userId, schoolId, ["school_admin"]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const records = await pool.query(
    `SELECT ar.id,ar.trip_id,ar.student_id,ar.event_type,ar.recorded_by,
            ar.recorded_at,st.full_name AS student_name,st.grade,
            t.trip_type,t.started_at,r.name AS route_name
       FROM attendance_records ar
       JOIN students st ON st.id=ar.student_id AND st.school_id=ar.school_id
       JOIN trips t ON t.id=ar.trip_id AND t.school_id=ar.school_id
       LEFT JOIN routes r ON r.id=t.route_id AND r.school_id=t.school_id
      WHERE ar.school_id=$1
      ORDER BY ar.recorded_at DESC
      LIMIT 300`,
    [schoolId],
  );
  return res.json({ records: records.rows });
}

module.exports = { methods: ["GET"], handler };
