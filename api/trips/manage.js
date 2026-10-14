const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.body?.school_id);
  const action = String(req.body?.action || "");
  const access = await tenant.requireSchoolRole(auth.userId, schoolId, [
    "school_admin",
    "driver",
  ]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }
  if (!["start", "end"].includes(action)) {
    throw new HttpError(400, "Supported actions are start and end.", "invalid_action");
  }

  if (action === "start") {
    const routeId = req.body?.route_id ? Number(req.body.route_id) : null;
    const vehicleId = req.body?.vehicle_id ? Number(req.body.vehicle_id) : null;
    const tripType = String(req.body?.trip_type || "pickup");
    if (!["pickup", "dropoff"].includes(tripType)) {
      throw new HttpError(400, "Invalid trip type.", "invalid_trip_type");
    }
    for (const [id, name] of [[routeId, "route_id"], [vehicleId, "vehicle_id"]]) {
      if (id !== null && (!Number.isSafeInteger(id) || id < 1)) {
        throw new HttpError(400, `${name} is invalid.`, "invalid_input");
      }
    }

    const trip = await withTransaction(pool, async (client) => {
      let driverId = null;
      if (access.membership.role === "driver") {
        const driver = await client.query(
          `SELECT id FROM drivers
            WHERE school_id=$1 AND user_id=$2 AND status='active'
            FOR UPDATE`,
          [schoolId, auth.userId],
        );
        if (!driver.rows.length) {
          throw new HttpError(403, "Driver profile is not active for this school.", "driver_inactive");
        }
        driverId = driver.rows[0].id;
        if (!routeId || !vehicleId) {
          throw new HttpError(400, "Choose your assigned route and vehicle.", "assignment_required");
        }
      }

      if (routeId) {
        const route = await client.query(
          `SELECT id FROM routes
            WHERE id=$1 AND school_id=$2 AND status='active'
            FOR UPDATE`,
          [routeId, schoolId],
        );
        if (!route.rows.length) {
          throw new HttpError(400, "Route does not belong to this school or is inactive.", "invalid_route");
        }
      }
      if (vehicleId) {
        const vehicle = await client.query(
          `SELECT id FROM vehicles
            WHERE id=$1 AND school_id=$2 AND status='active'
            FOR UPDATE`,
          [vehicleId, schoolId],
        );
        if (!vehicle.rows.length) {
          throw new HttpError(400, "Vehicle does not belong to this school or is inactive.", "invalid_vehicle");
        }
      }

      if (driverId) {
        const assignment = await client.query(
          `SELECT id FROM vehicle_assignments
            WHERE school_id=$1 AND driver_id=$2 AND vehicle_id=$3
              AND route_id=$4 AND valid_to IS NULL
            LIMIT 1 FOR UPDATE`,
          [schoolId, driverId, vehicleId, routeId],
        );
        if (!assignment.rows.length) {
          throw new HttpError(403, "That route and vehicle are not assigned to you.", "assignment_mismatch");
        }
      }

      const activeTrip = await client.query(
        `SELECT id FROM trips
          WHERE school_id=$1 AND status='active'
            AND (($2::bigint IS NOT NULL AND driver_id=$2)
              OR ($3::bigint IS NOT NULL AND vehicle_id=$3))
          LIMIT 1 FOR UPDATE`,
        [schoolId, driverId, vehicleId],
      );
      if (activeTrip.rows.length) {
        throw new HttpError(409, "This driver or vehicle already has an active trip.", "active_trip");
      }

      const result = await client.query(
        `INSERT INTO trips
           (school_id,route_id,vehicle_id,driver_id,trip_type,status,started_at)
         VALUES ($1,$2,$3,$4,$5,'active',now())
         RETURNING id,school_id,route_id,vehicle_id,driver_id,trip_type,status,started_at`,
        [schoolId, routeId, vehicleId, driverId, tripType],
      );
      await tenant.writeAudit({
        client,
        schoolId,
        actorUserId: auth.userId,
        action: "trip.started",
        targetType: "trip",
        targetId: result.rows[0].id,
      });
      return result.rows[0];
    });
    return res.status(201).json({ trip });
  }

  const tripId = Number(req.body?.trip_id);
  if (!Number.isSafeInteger(tripId) || tripId < 1) {
    throw new HttpError(400, "trip_id is required.", "invalid_trip");
  }
  await withTransaction(pool, async (client) => {
    const trip = await client.query(
      `SELECT id,driver_id,status
         FROM trips WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [tripId, schoolId],
    );
    if (!trip.rows.length) {
      throw new HttpError(404, "Trip not found.", "trip_not_found");
    }

    if (access.membership.role === "driver") {
      const driver = await client.query(
        `SELECT id FROM drivers
          WHERE school_id=$1 AND user_id=$2 AND status='active'`,
        [schoolId, auth.userId],
      );
      if (
        !driver.rows.length ||
        Number(trip.rows[0].driver_id) !== Number(driver.rows[0]?.id)
      ) {
        throw new HttpError(403, "This trip is not assigned to you.", "trip_assignment_mismatch");
      }
    }
    if (trip.rows[0].status !== "active") {
      throw new HttpError(409, "Only active trips can be ended.", "trip_not_active");
    }

    await client.query(
      `UPDATE trips SET status='completed',ended_at=now()
        WHERE id=$1 AND school_id=$2`,
      [tripId, schoolId],
    );
    await client.query("DELETE FROM current_trip_locations WHERE trip_id=$1", [tripId]);
    await tenant.writeAudit({
      client,
      schoolId,
      actorUserId: auth.userId,
      action: "trip.ended",
      targetType: "trip",
      targetId: tripId,
    });
  });
  return res.json({ ok: true, status: "completed" });
}

module.exports = { methods: ["POST"], handler };
