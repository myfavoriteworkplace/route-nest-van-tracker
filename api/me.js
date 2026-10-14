const { withTransaction } = require("../server/database");
const { context, requiredText } = require("../server/api-utils");

async function acceptPendingInvite(pool, tenant, userId, email, inviteId) {
  await withTransaction(pool, async (client) => {
    const inviteResult = await client.query(
      `SELECT id,school_id,role,student_id
         FROM school_invites
        WHERE id=$1 AND lower(email)=$2 AND status='pending'
        FOR UPDATE`,
      [inviteId, email],
    );
    const invite = inviteResult.rows[0];
    if (!invite) return;

    const school = await client.query(
      "SELECT id FROM schools WHERE id=$1 AND status='active' FOR UPDATE",
      [invite.school_id],
    );
    if (!school.rows.length) return;
    if (!["driver", "parent"].includes(invite.role)) return;

    if (invite.role === "parent") {
      const student = await client.query(
        "SELECT id FROM students WHERE id=$1 AND school_id=$2 AND status='active'",
        [invite.student_id, invite.school_id],
      );
      if (!student.rows.length) return;
    }

    const membership = await client.query(
      `INSERT INTO school_memberships (school_id,user_id,role,status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (school_id,user_id) DO UPDATE
         SET status='active'
         WHERE school_memberships.role=EXCLUDED.role
       RETURNING role`,
      [invite.school_id, userId, invite.role],
    );
    if (!membership.rows.length) return;

    if (invite.role === "driver") {
      await client.query(
        `INSERT INTO drivers (school_id,user_id,status)
         VALUES ($1,$2,'active')
         ON CONFLICT (school_id,user_id) DO UPDATE SET status='active'`,
        [invite.school_id, userId],
      );
    } else {
      const guardian = await client.query(
        `INSERT INTO guardians (school_id,user_id,relationship)
         VALUES ($1,$2,'guardian')
         ON CONFLICT (school_id,user_id) DO UPDATE SET relationship='guardian'
         RETURNING id`,
        [invite.school_id, userId],
      );
      const guardianId =
        guardian.rows[0]?.id ||
        (
          await client.query(
            "SELECT id FROM guardians WHERE school_id=$1 AND user_id=$2",
            [invite.school_id, userId],
          )
        ).rows[0]?.id;
      await client.query(
        `INSERT INTO student_guardians (student_id,guardian_id)
         VALUES ($1,$2)
         ON CONFLICT (student_id,guardian_id) DO NOTHING`,
        [invite.student_id, guardianId],
      );
    }

    await client.query(
      "UPDATE school_invites SET status='accepted',accepted_at=now() WHERE id=$1",
      [invite.id],
    );
    await tenant.writeAudit({
      client,
      schoolId: invite.school_id,
      actorUserId: userId,
      action: "school.invite_accepted",
      targetType: "school_invite",
      targetId: invite.id,
      details: { role: invite.role },
    });
  });
}

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const userId = String(auth.userId);

  if (req.method === "GET") {
    const email = String(auth.email || "").trim().toLowerCase();
    if (email) {
      await pool.query(
        `INSERT INTO user_profiles (user_id,email)
         VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE
           SET email=EXCLUDED.email,updated_at=now()`,
        [userId, email],
      );
      const invites = await pool.query(
        `SELECT id
           FROM school_invites
          WHERE lower(email)=$1 AND status='pending'
          ORDER BY id ASC
          LIMIT 25`,
        [email],
      );
      for (const invite of invites.rows) {
        await acceptPendingInvite(pool, tenant, userId, email, invite.id);
      }
    }

    const profile = await pool.query(
      `SELECT user_id,full_name,phone,status
         FROM user_profiles WHERE user_id=$1`,
      [userId],
    );
    return res.json({
      user: { id: userId, email, ...(profile.rows[0] || {}) },
      isPlatformAdmin: await tenant.isPlatformAdmin(userId),
      memberships: await tenant.membershipsFor(userId),
    });
  }

  const fullName = String(req.body?.full_name || "").trim().slice(0, 120);
  const phone = String(req.body?.phone || "").trim().slice(0, 30) || null;
  if (fullName.length > 120) {
    requiredText(fullName, "Full name", 120);
  }
  await pool.query(
    `INSERT INTO user_profiles (user_id,full_name,phone)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE
       SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,updated_at=now()`,
    [userId, fullName, phone],
  );
  return res.json({ ok: true });
}

module.exports = { methods: ["GET", "PUT"], handler };
