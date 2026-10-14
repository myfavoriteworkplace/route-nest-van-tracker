const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.query?.school_id);
  const studentId = Number(req.query?.student_id);
  if (!Number.isSafeInteger(studentId) || studentId < 1) {
    throw new HttpError(400, "school_id and student_id are required.", "invalid_student");
  }
  const access = await tenant.requireSchoolRole(auth.userId, schoolId, ["parent"]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const result = await pool.query(
    `SELECT t.id AS trip_id,t.status,t.started_at,
            ctl.latitude,ctl.longitude,ctl.accuracy_m,ctl.recorded_at
       FROM students st
       JOIN student_guardians sg ON sg.student_id=st.id
       JOIN guardians g ON g.id=sg.guardian_id
       JOIN student_route_assignments sra
         ON sra.student_id=st.id AND sra.school_id=st.school_id
        AND sra.valid_to IS NULL
       JOIN trips t
         ON t.route_id=sra.route_id AND t.school_id=st.school_id
        AND t.status='active'
       LEFT JOIN current_trip_locations ctl ON ctl.trip_id=t.id
      WHERE st.id=$1 AND st.school_id=$2 AND st.status='active'
        AND g.user_id=$3 AND g.school_id=$2
      ORDER BY t.started_at DESC
      LIMIT 1`,
    [studentId, schoolId, auth.userId],
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: "No active trip is available for this child." });
  }

  const row = result.rows[0];
  const hasLocation = row.latitude !== null && row.longitude !== null;
  return res.json({
    trip_id: row.trip_id,
    status: row.status,
    location: hasLocation
      ? {
          latitude: row.latitude,
          longitude: row.longitude,
          accuracy_m: row.accuracy_m,
          recorded_at: row.recorded_at,
          is_stale:
            !row.recorded_at ||
            Date.now() - new Date(row.recorded_at).getTime() > 60_000,
        }
      : null,
  });
}

module.exports = { methods: ["GET"], handler };
