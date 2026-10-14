const { withTransaction } = require("../../server/database");
const {
  context,
  schoolId: parseSchoolId,
  HttpError,
} = require("../../server/api-utils");

async function getForDriver(pool, schoolId, userId, driverId) {
  const vehicles = await pool.query(
    `SELECT v.id,v.registration_number,v.label,v.capacity,v.status
       FROM vehicle_assignments a
       JOIN vehicles v ON v.id=a.vehicle_id AND v.school_id=a.school_id
      WHERE a.school_id=$1 AND a.driver_id=$2 AND a.valid_to IS NULL
        AND v.status='active'
      ORDER BY v.registration_number`,
    [schoolId, driverId],
  );
  const routes = await pool.query(
    `SELECT DISTINCT r.id,r.name,r.description,r.status
       FROM vehicle_assignments a
       JOIN routes r ON r.id=a.route_id AND r.school_id=a.school_id
      WHERE a.school_id=$1 AND a.driver_id=$2 AND a.valid_to IS NULL
        AND r.status='active'
      ORDER BY r.name`,
    [schoolId, driverId],
  );
  const students = await pool.query(
    `SELECT DISTINCT st.id,st.full_name,st.grade,st.student_code,
            r.name AS route_name
       FROM student_route_assignments a
       JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
       JOIN routes r ON r.id=a.route_id AND r.school_id=a.school_id
       JOIN vehicle_assignments va
         ON va.route_id=r.id AND va.school_id=r.school_id
        AND va.driver_id=$2 AND va.valid_to IS NULL
      WHERE a.school_id=$1 AND a.valid_to IS NULL AND st.status='active'
      ORDER BY st.full_name`,
    [schoolId, driverId],
  );
  const trips = await pool.query(
    `SELECT t.id,t.trip_type,t.status,t.started_at,t.ended_at,
            r.name AS route_name,v.registration_number
       FROM trips t
       LEFT JOIN routes r ON r.id=t.route_id AND r.school_id=t.school_id
       LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.school_id=t.school_id
      WHERE t.school_id=$1 AND t.driver_id=$2
      ORDER BY t.created_at DESC
      LIMIT 30`,
    [schoolId, driverId],
  );
  return {
    school_id: schoolId,
    role: "driver",
    vehicles: vehicles.rows,
    routes: routes.rows,
    students: students.rows,
    trips: trips.rows,
    subscription: null,
  };
}

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(
    req.method === "GET" ? req.query?.school_id : req.body?.school_id,
  );
  const check = await tenant.requireSchoolRole(
    auth.userId,
    schoolId,
    req.method === "POST"
      ? ["school_admin"]
      : ["school_admin", "driver", "parent"],
  );
  if (check.error) {
    return res.status(check.status || 403).json({ error: check.error });
  }

  if (req.method === "GET") {
    if (check.membership.role === "driver") {
      const driver = await pool.query(
        `SELECT id FROM drivers
          WHERE school_id=$1 AND user_id=$2 AND status='active'`,
        [schoolId, auth.userId],
      );
      if (!driver.rows.length) {
        return res.status(403).json({ error: "Driver profile is not active for this school." });
      }
      return res.json(
        await getForDriver(pool, schoolId, auth.userId, driver.rows[0].id),
      );
    }

    if (check.membership.role === "parent") {
      const children = await pool.query(
        `SELECT st.id,st.full_name,st.grade,st.student_code
           FROM students st
           JOIN student_guardians sg ON sg.student_id=st.id
           JOIN guardians g ON g.id=sg.guardian_id
          WHERE st.school_id=$1 AND g.user_id=$2 AND g.school_id=$1
            AND st.status='active'
          ORDER BY st.full_name`,
        [schoolId, auth.userId],
      );
      return res.json({
        school_id: schoolId,
        role: check.membership.role,
        students: children.rows,
      });
    }

    const [school, vehicles, routes, students, drivers, trips, subscription] =
      await Promise.all([
        pool.query(
          "SELECT id,name,slug,status,timezone FROM schools WHERE id=$1",
          [schoolId],
        ),
        pool.query(
          `SELECT id,registration_number,label,capacity,status
             FROM vehicles WHERE school_id=$1 ORDER BY id DESC LIMIT 200`,
          [schoolId],
        ),
        pool.query(
          `SELECT id,name,description,status
             FROM routes WHERE school_id=$1 ORDER BY id DESC LIMIT 200`,
          [schoolId],
        ),
        pool.query(
          `SELECT id,student_code,full_name,grade,status
             FROM students WHERE school_id=$1 ORDER BY id DESC LIMIT 300`,
          [schoolId],
        ),
        pool.query(
          `SELECT d.id,d.user_id,COALESCE(up.email,'') AS email,
                  COALESCE(up.full_name,'') AS full_name,d.status
             FROM drivers d
             LEFT JOIN user_profiles up ON up.user_id=d.user_id
            WHERE d.school_id=$1 ORDER BY d.id DESC LIMIT 200`,
          [schoolId],
        ),
        pool.query(
          `SELECT t.id,t.trip_type,t.status,t.started_at,t.ended_at,
                  r.name AS route_name,v.registration_number
             FROM trips t
             LEFT JOIN routes r ON r.id=t.route_id AND r.school_id=t.school_id
             LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.school_id=t.school_id
            WHERE t.school_id=$1
            ORDER BY t.created_at DESC LIMIT 50`,
          [schoolId],
        ),
        pool.query(
          `SELECT sub.id,sub.status,sub.billing_interval,sub.trial_ends_at,
                  sub.current_period_end,sub.cancel_at_period_end,
                  p.name AS plan_name,p.monthly_price_paise,p.annual_price_paise
             FROM subscriptions sub
             JOIN plans p ON p.id=sub.plan_id
            WHERE sub.school_id=$1
            ORDER BY sub.updated_at DESC,sub.id DESC LIMIT 1`,
          [schoolId],
        ),
      ]);
    return res.json({
      school: school.rows[0],
      role: check.membership.role,
      vehicles: vehicles.rows,
      routes: routes.rows,
      students: students.rows,
      drivers: drivers.rows,
      trips: trips.rows,
      subscription: subscription.rows[0] || null,
    });
  }

  const type = String(req.body?.type || "");
  if (String(req.body?.action || "create") !== "create") {
    throw new HttpError(400, "Only create is supported for this resource in this release.", "invalid_action");
  }

  let item;
  if (type === "vehicle") {
    const registration = String(req.body?.registration_number || "")
      .trim()
      .toUpperCase();
    const label = String(req.body?.label || "").trim();
    const capacity = Number(req.body?.capacity);
    if (!registration || registration.length > 30) {
      throw new HttpError(400, "Vehicle registration is required.", "invalid_input");
    }
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100) {
      throw new HttpError(400, "Vehicle capacity must be between 0 and 100.", "invalid_input");
    }
    if (label.length > 100) {
      throw new HttpError(400, "Vehicle label is too long.", "invalid_input");
    }
    const result = await pool.query(
      `INSERT INTO vehicles (school_id,registration_number,label,capacity)
       VALUES ($1,$2,$3,$4)
       RETURNING id,registration_number,label,capacity,status`,
      [schoolId, registration, label, capacity],
    );
    item = result.rows[0];
  } else if (type === "route") {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    if (name.length < 2 || name.length > 120) {
      throw new HttpError(400, "Route name must be between 2 and 120 characters.", "invalid_input");
    }
    if (description && description.length > 500) {
      throw new HttpError(400, "Route description is too long.", "invalid_input");
    }
    const result = await pool.query(
      `INSERT INTO routes (school_id,name,description)
       VALUES ($1,$2,$3)
       RETURNING id,name,description,status`,
      [schoolId, name, description],
    );
    item = result.rows[0];
  } else if (type === "student") {
    const fullName = String(req.body?.full_name || "").trim();
    const grade = String(req.body?.grade || "").trim() || null;
    const studentCode = String(req.body?.student_code || "").trim() || null;
    const routeId = req.body?.route_id ? Number(req.body.route_id) : null;
    if (fullName.length < 2 || fullName.length > 120) {
      throw new HttpError(400, "Student name must be between 2 and 120 characters.", "invalid_input");
    }
    if (grade && grade.length > 40) {
      throw new HttpError(400, "Grade or class is too long.", "invalid_input");
    }
    if (studentCode && studentCode.length > 40) {
      throw new HttpError(400, "Student code is too long.", "invalid_input");
    }
    if (
      routeId !== null &&
      (!Number.isSafeInteger(routeId) || routeId < 1)
    ) {
      throw new HttpError(400, "Selected route is invalid.", "invalid_input");
    }

    item = await withTransaction(pool, async (client) => {
      if (routeId) {
        const route = await client.query(
          `SELECT id FROM routes
            WHERE id=$1 AND school_id=$2 AND status='active'
            FOR UPDATE`,
          [routeId, schoolId],
        );
        if (!route.rows.length) {
          throw new HttpError(400, "Selected route does not belong to this school.", "invalid_route");
        }
      }
      const student = await client.query(
        `INSERT INTO students (school_id,full_name,grade,student_code)
         VALUES ($1,$2,$3,$4)
         RETURNING id,full_name,grade,student_code,status`,
        [schoolId, fullName, grade, studentCode],
      );
      if (routeId) {
        await client.query(
          `INSERT INTO student_route_assignments (school_id,student_id,route_id)
           VALUES ($1,$2,$3)`,
          [schoolId, student.rows[0].id, routeId],
        );
      }
      await tenant.writeAudit({
        client,
        schoolId,
        actorUserId: auth.userId,
        action: "student.created",
        targetType: "student",
        targetId: student.rows[0].id,
      });
      return student.rows[0];
    });
  } else if (type === "assignment") {
    const vehicleId = Number(req.body?.vehicle_id);
    const routeId = Number(req.body?.route_id);
    const driverUserId = String(req.body?.driver_user_id || "").trim();
    if (
      !Number.isSafeInteger(vehicleId) ||
      vehicleId < 1 ||
      !Number.isSafeInteger(routeId) ||
      routeId < 1 ||
      !driverUserId ||
      driverUserId.length > 200
    ) {
      throw new HttpError(400, "Choose a vehicle, route and accepted driver.", "invalid_input");
    }
    item = await withTransaction(pool, async (client) => {
      const vehicle = await client.query(
        `SELECT id FROM vehicles
          WHERE id=$1 AND school_id=$2 AND status='active'
          FOR UPDATE`,
        [vehicleId, schoolId],
      );
      const route = await client.query(
        `SELECT id FROM routes
          WHERE id=$1 AND school_id=$2 AND status='active'
          FOR UPDATE`,
        [routeId, schoolId],
      );
      const driver = await client.query(
        `SELECT id FROM drivers
          WHERE school_id=$1 AND user_id=$2 AND status='active'
          FOR UPDATE`,
        [schoolId, driverUserId],
      );
      if (!vehicle.rows.length || !route.rows.length || !driver.rows.length) {
        throw new HttpError(
          400,
          "Vehicle, route and accepted driver must all belong to this school.",
          "invalid_assignment",
        );
      }
      const activeTrip = await client.query(
        `SELECT id FROM trips
          WHERE school_id=$1 AND status='active'
            AND (vehicle_id=$2 OR driver_id=$3)
          LIMIT 1 FOR UPDATE`,
        [schoolId, vehicleId, driver.rows[0].id],
      );
      if (activeTrip.rows.length) {
        throw new HttpError(409, "End the active trip before changing its assignment.", "active_trip");
      }
      await client.query(
        `UPDATE vehicle_assignments
            SET valid_to=CURRENT_DATE
          WHERE school_id=$1 AND valid_to IS NULL
            AND (vehicle_id=$2 OR driver_id=$3)`,
        [schoolId, vehicleId, driver.rows[0].id],
      );
      const assignment = await client.query(
        `INSERT INTO vehicle_assignments (school_id,vehicle_id,route_id,driver_id)
         VALUES ($1,$2,$3,$4)
         RETURNING id,vehicle_id,route_id,driver_id,valid_from`,
        [schoolId, vehicleId, routeId, driver.rows[0].id],
      );
      await tenant.writeAudit({
        client,
        schoolId,
        actorUserId: auth.userId,
        action: "assignment.created",
        targetType: "vehicle_assignment",
        targetId: assignment.rows[0].id,
        details: { vehicle_id: vehicleId, route_id: routeId },
      });
      return assignment.rows[0];
    });
  } else {
    throw new HttpError(
      400,
      "Supported types are vehicle, route, student and assignment.",
      "invalid_resource_type",
    );
  }

  if (type === "vehicle" || type === "route") {
    await tenant.writeAudit({
      schoolId,
      actorUserId: auth.userId,
      action: `${type}.created`,
      targetType: type,
      targetId: item.id,
    });
  }
  return res.status(201).json({ item });
}

module.exports = { methods: ["GET", "POST"], handler };
