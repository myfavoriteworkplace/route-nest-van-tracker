CREATE TABLE IF NOT EXISTS schools (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  contact_email TEXT NOT NULL,
  phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS school_memberships (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('school_admin','driver','parent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);
CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  monthly_price_paise INTEGER NOT NULL CHECK (monthly_price_paise >= 0),
  annual_price_paise INTEGER NOT NULL CHECK (annual_price_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  trial_days INTEGER NOT NULL DEFAULT 14,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plans (code, name, monthly_price_paise, annual_price_paise, trial_days)
VALUES ('school-standard', 'School Standard', 99900, 999000, 14)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES plans(id),
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_customer_id TEXT,
  provider_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','pending','active','past_due','suspended','cancelled','expired')),
  billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly','annual')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_subscription_per_school
ON subscriptions (school_id)
WHERE status IN ('trialing','pending','active','past_due','suspended');
CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES schools(id) ON DELETE SET NULL,
  subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider_payment_id TEXT UNIQUE,
  provider_event_id TEXT,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_url TEXT,
  paid_at TIMESTAMPTZ,
  raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored')),
  error_summary TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS vehicles (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  registration_number TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, registration_number)
);
CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);
CREATE TABLE IF NOT EXISTS routes (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS route_stops (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  scheduled_time TEXT,
  UNIQUE (route_id, sequence)
);
CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_code TEXT,
  full_name TEXT NOT NULL,
  grade TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_code)
);
CREATE TABLE IF NOT EXISTS guardians (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  relationship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);
CREATE TABLE IF NOT EXISTS student_guardians (
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id BIGINT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, guardian_id)
);
CREATE TABLE IF NOT EXISTS student_route_assignments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id BIGINT NOT NULL REFERENCES routes(id),
  stop_id BIGINT REFERENCES route_stops(id),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE
);
CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id),
  driver_id BIGINT REFERENCES drivers(id),
  route_id BIGINT REFERENCES routes(id),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE
);
CREATE TABLE IF NOT EXISTS trips (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_id BIGINT REFERENCES routes(id),
  vehicle_id BIGINT REFERENCES vehicles(id),
  driver_id BIGINT REFERENCES drivers(id),
  trip_type TEXT NOT NULL DEFAULT 'pickup' CHECK (trip_type IN ('pickup','dropoff')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS current_trip_locations (
  trip_id BIGINT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trip_locations (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('boarded','dropped_off','absent')),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, student_id, event_type)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES schools(id) ON DELETE SET NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_events (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  recipient_user_id TEXT,
  trip_id BIGINT REFERENCES trips(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON school_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_school ON school_memberships(school_id, role, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_school_status ON subscriptions(school_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicles_school ON vehicles(school_id, status);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, status);
CREATE INDEX IF NOT EXISTS idx_routes_school ON routes(school_id, status);
CREATE INDEX IF NOT EXISTS idx_trips_school_status ON trips(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_locations_trip_time ON trip_locations(trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_school_trip ON attendance_records(school_id, trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_school_time ON audit_logs(school_id, created_at DESC);