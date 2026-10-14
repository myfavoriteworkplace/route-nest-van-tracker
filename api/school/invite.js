const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, validEmail, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(
    req.method === "GET" ? req.query?.school_id : req.body?.school_id,
  );
  const access = await tenant.requireSchoolRole(auth.userId, schoolId, ["school_admin"]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  if (req.method === "GET") {
    const invites = await pool.query(
      `SELECT id,email,role,student_id,status,created_at,accepted_at
         FROM school_invites
        WHERE school_id=$1
        ORDER BY id DESC
        LIMIT 100`,
      [schoolId],
    );
    return res.json({ invites: invites.rows });
  }

  const email = validEmail(req.body?.email);
  const role = String(req.body?.role || "");
  if (!["driver", "parent"].includes(role)) {
    throw new HttpError(400, "Only driver and parent invitations are supported here.", "invalid_role");
  }

  let studentId = null;
  if (role === "parent") {
    studentId = Number(req.body?.student_id);
    if (!Number.isSafeInteger(studentId) || studentId < 1) {
      throw new HttpError(400, "Choose the student this guardian is authorized to view.", "invalid_student");
    }
  }

  const invite = await withTransaction(pool, async (client) => {
    if (role === "parent") {
      const student = await client.query(
        `SELECT id FROM students
          WHERE id=$1 AND school_id=$2 AND status='active'
          FOR UPDATE`,
        [studentId, schoolId],
      );
      if (!student.rows.length) {
        throw new HttpError(400, "Student does not belong to this school.", "invalid_student");
      }
    }

    const result = await client.query(
      `INSERT INTO school_invites
         (school_id,email,role,student_id,invited_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (school_id,email,role) WHERE status='pending'
       DO UPDATE SET student_id=EXCLUDED.student_id,invited_by=EXCLUDED.invited_by
       RETURNING id,email,role,student_id,status,created_at`,
      [schoolId, email, role, role === "parent" ? studentId : null, auth.userId],
    );
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: "school.invite_created",
      targetType: "school_invite",
      targetId: result.rows[0].id,
      details: {
        email,
        role,
        student_id: role === "parent" ? studentId : null,
      },
    });
    return result.rows[0];
  });

  return res.status(201).json({
    invite,
    message:
      "Invitation saved. The invited person must sign in with this exact email to join the school.",
  });
}

module.exports = { methods: ["GET", "POST"], handler };
