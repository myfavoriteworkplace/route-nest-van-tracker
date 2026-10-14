const { withTransaction } = require("../../server/database");
const { context, schoolId: parseSchoolId, HttpError } = require("../../server/api-utils");

async function handler(req, res) {
  const { auth, pool, tenant } = context(req);
  const schoolId = parseSchoolId(req.body?.school_id);
  const tripId = Number(req.body?.trip_id);
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy =
    req.body?.accuracy_m === undefined || req.body?.accuracy_m === null
      ? null
      : Number(req.body.accuracy_m);
  if (
    !Number.isSafeInteger(tripId) ||
    tripId < 1 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000))
  ) {
    throw new HttpError(400, "Valid school, trip and coordinates are required.", "invalid_location");
  }

  const access = await tenant.requireSchoolRole(auth.userId, schoolId, ["driver"]);
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  const recordedAt = await withTransaction(pool, async (client) => {
    const driver = await client.query(
      `SELECT id FROM drivers
        WHERE school_id=$1 AND user_id=$2 AND status='active'`,
      [schoolId, auth.userId],
    );
    if (!driver.rows.length) {
      throw new HttpError(403, "Driver profile is not active for this school.", "driver_inactive");
    }

    const trip = await client.query(
      `SELECT id FROM trips
        WHERE id=$1 AND school_id=$2 AND driver_id=$3 AND status='active'
        FOR UPDATE`,
      [tripId, schoolId, driver.rows[0].id],
    );
    if (!trip.rows.length) {
      throw new HttpError(403, "Location can only be sent for your own active trip.", "trip_assignment_mismatch");
    }

    const previous = await client.query(
      `SELECT recorded_at FROM current_trip_locations
        WHERE trip_id=$1 FOR UPDATE`,
      [tripId],
    );
    if (
      previous.rows[0] &&
      Date.now() - new Date(previous.rows[0].recorded_at).getTime() < 3_000
    ) {
      throw new HttpError(429, "Location updates are arriving too quickly. Wait a few seconds.", "location_rate_limited");
    }

    const timestamp = new Date();
    await client.query(
      `INSERT INTO current_trip_locations
         (trip_id,school_id,latitude,longitude,accuracy_m,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (trip_id) DO UPDATE
         SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
             accuracy_m=EXCLUDED.accuracy_m,recorded_at=EXCLUDED.recorded_at`,
      [tripId, schoolId, latitude, longitude, accuracy, timestamp],
    );
    await client.query(
      `INSERT INTO trip_locations
         (trip_id,school_id,latitude,longitude,accuracy_m,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tripId, schoolId, latitude, longitude, accuracy, timestamp],
    );
    return timestamp.toISOString();
  });

  return res.json({ ok: true, recorded_at: recordedAt });
}

module.exports = { methods: ["POST"], handler };
