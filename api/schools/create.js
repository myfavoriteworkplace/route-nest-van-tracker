const crypto = require("node:crypto");
const { withTransaction } = require("../../server/database");
const { context, validEmail, HttpError } = require("../../server/api-utils");
const { slugify } = require("../../lib/tenant");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const userId = String(auth.userId);
  const name = String(req.body?.name || "").trim();
  if (name.length < 2 || name.length > 160) {
    throw new HttpError(400, "Enter a school name between 2 and 160 characters.", "invalid_input");
  }
  const email = validEmail(req.body?.contact_email || auth.email, "School contact email");
  const phone = String(req.body?.phone || "").trim().slice(0, 30) || null;
  const fullName = String(req.body?.admin_name || "").trim().slice(0, 120);

  const created = await withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [userId]);
    const existing = await client.query(
      `SELECT school_id FROM school_memberships
        WHERE user_id=$1 AND role='school_admin' AND status='active'
        LIMIT 1`,
      [userId],
    );
    if (existing.rows.length) {
      throw new HttpError(
        409,
        "This account already administers a school. Contact support to manage additional schools.",
        "school_admin_exists",
      );
    }

    const plan = await client.query(
      `SELECT id,trial_days FROM plans
        WHERE code='school-standard' AND active=true
        LIMIT 1`,
    );
    if (!plan.rows.length) {
      throw new HttpError(503, "No active subscription plan is configured.", "plan_not_configured");
    }

    const baseSlug = slugify(name);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const collision = await client.query("SELECT 1 FROM schools WHERE slug=$1", [slug]);
      if (!collision.rows.length) break;
      slug = `${baseSlug.slice(0, 39)}-${crypto.randomBytes(3).toString("hex")}`;
    }
    if ((await client.query("SELECT 1 FROM schools WHERE slug=$1", [slug])).rows.length) {
      throw new HttpError(409, "A workspace with a similar name already exists. Try another name.", "slug_conflict");
    }

    const schoolResult = await client.query(
      `INSERT INTO schools (name,slug,contact_email,phone)
       VALUES ($1,$2,$3,$4)
       RETURNING id,name,slug,status,created_at`,
      [name, slug, email, phone],
    );
    const school = schoolResult.rows[0];
    const trialDays = Math.max(0, Math.min(365, Number(plan.rows[0].trial_days) || 0));
    const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);

    await client.query(
      `INSERT INTO user_profiles (user_id,full_name,phone)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE
         SET full_name=CASE
               WHEN EXCLUDED.full_name<>'' THEN EXCLUDED.full_name
               ELSE user_profiles.full_name
             END,
             phone=COALESCE(EXCLUDED.phone,user_profiles.phone),
             updated_at=now()`,
      [userId, fullName, phone],
    );
    await client.query(
      `INSERT INTO school_memberships (school_id,user_id,role,status)
       VALUES ($1,$2,'school_admin','active')`,
      [school.id, userId],
    );
    await client.query(
      `INSERT INTO subscriptions
         (school_id,plan_id,status,trial_ends_at,billing_interval)
       VALUES ($1,$2,'trialing',$3,'monthly')`,
      [school.id, plan.rows[0].id, trialEndsAt],
    );
    await tenant.writeAudit({
      client,
      schoolId: school.id,
      actorUserId: userId,
      action: "school.created",
      targetType: "school",
      targetId: school.id,
      details: { slug },
    });

    return { school, trialEndsAt };
  });

  return res.status(201).json({
    school: created.school,
    trial_ends_at: created.trialEndsAt.toISOString(),
    message:
      "School workspace created. Trial access is enabled; connect billing before the trial ends.",
  });
}

module.exports = { methods: ["POST"], handler };
