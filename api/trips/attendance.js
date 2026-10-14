const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.body?.school_id);
  const tripId = Number(req.body?.trip_id);
  const studentId = Number(req.body?.student_id);
  const eventType = String(req.body?.event_type || "");
  if (
    !Number.isSafeInteger(tripId) ||
    tripId < 1 ||
    !Number.isSafeInteger(studentId) ||
    studentId < 1 ||
    !["boarded", "dropped_off", "absent"].includes(eventType)
  ) {
    throw new HttpError(
      400,
      "School, trip, student and a valid attendance event are required.",
      "invalid_attendance",
    );
  }

  const access = await tenant.requireSchoolRole(auth.userId, schoolId, [
    "school_admin",
    "driver",
  ]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const result = await withTransaction(pool, async (client) => {
    const trip = await client.query(
      `SELECT id,route_id,driver_id,status
         FROM trips WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [tripId, schoolId],
    );
    if (!trip.rows.length) {
      throw new HttpError(404, "Trip not found.", "trip_not_found");
    }
    const row = trip.rows[0];
    if (row.status !== "active") {
      throw new HttpError(409, "Attendance can only be changed during an active trip.", "trip_not_active");
    }

    if (access.membership.role === "driver") {
      const driver = await client.query(
        `SELECT id FROM drivers
          WHERE school_id=$1 AND user_id=$2 AND status='active'`,
        [schoolId, auth.userId],
      );
      if (
        !driver.rows.length ||
        Number(row.driver_id) !== Number(driver.rows[0]?.id)
      ) {
        throw new HttpError(403, "This trip is not assigned to you.", "trip_assignment_mismatch");
      }
    }

    const student = await client.query(
      `SELECT st.id FROM students st
       JOIN student_route_assignments a
         ON a.student_id=st.id AND a.school_id=st.school_id AND a.valid_to IS NULL
       WHERE st.id=$1 AND st.school_id=$2 AND a.route_id=$3
         AND st.status='active'`,
      [studentId, schoolId, row.route_id],
    );
    if (!student.rows.length) {
      throw new HttpError(403, "Student is not assigned to this trip route.", "student_route_mismatch");
    }

    const history = await client.query(
      `SELECT id,event_type,recorded_by,recorded_at
         FROM attendance_records
        WHERE trip_id=$1 AND student_id=$2
        ORDER BY recorded_at ASC,id ASC
        FOR UPDATE`,
      [tripId, studentId],
    );
    const priorTypes = new Set(history.rows.map((entry) => entry.event_type));
    const sameEvent = history.rows.find((entry) => entry.event_type === eventType);
    if (sameEvent) return { attendance: sameEvent, duplicate: true };

    const invalidTransition =
      (eventType === "boarded" &&
        (priorTypes.has("absent") || priorTypes.has("dropped_off"))) ||
      (eventType === "absent" && priorTypes.size > 0) ||
      (eventType === "dropped_off" &&
        (!priorTypes.has("boarded") || priorTypes.has("absent")));
    if (invalidTransition) {
      throw new HttpError(409, "That attendance change is not a valid next step.", "invalid_attendance_transition");
    }

    const attendance = await client.query(
      `INSERT INTO attendance_records
         (school_id,trip_id,student_id,event_type,recorded_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,trip_id,student_id,event_type,recorded_by,recorded_at`,
      [schoolId, tripId, studentId, eventType, auth.userId],
    );
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: `attendance.${eventType}`,
      targetType: "attendance",
      targetId: attendance.rows[0].id,
      details: { trip_id: tripId, student_id: studentId },
    });
    return { attendance: attendance.rows[0], duplicate: false };
  });

  return res.json(result);
}

module.exports = { methods: ["POST"], handler };
