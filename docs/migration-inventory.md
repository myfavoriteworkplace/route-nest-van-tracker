# Hatchable Source Inventory — School Van Tracker

This document records what the imported source currently does, as observed
before conversion. It complements
[`hatchable-to-render-migration.md`](hatchable-to-render-migration.md), which
describes the staged target migration.

This is a source audit, not an implementation or a claim that runtime behavior
has been independently verified against a live Hatchable deployment. Where a
platform behavior is not implemented in this repository, it is marked as
unknown and must be confirmed rather than assumed.

**Snapshot timing:** This inventory records the imported Hatchable source
before the Phase 2 server foundation was added. Statements below about the
absence of a package manifest, server, or migration runner describe that
original audit baseline. For current migration progress, see the
[migration plan](hatchable-to-render-migration.md).

## Repository and runtime shape

- `api/` contains 15 JavaScript handler files. They export `methods` arrays
  and, except the public webhook, `access = 'user'`. They are not Express
  routers and import Hatchable's `db`, `config`, or `webhooks` helpers.
- `lib/tenant.js` contains four shared database/authorization helpers and a
  slug formatter. It imports `db` from Hatchable.
- `public/index.html` loads `saas.js`; the latter calls the API using
  same-origin `/api/...` paths and uses Hatchable Auth.
- `public/login.html` calls Hatchable Auth methods directly for email-code
  login and session checks.
- `public/app.js` is a separate, hard-coded dashboard demo with in-memory
  sample data. `index.html` does not load it. Its demo edits are not persisted.
- `public/saas.css` styles the current SaaS workspace/login views.
  `public/style.css` is loaded by the current index page but contains the
  separate demo dashboard's styling.
- `migrations/` contains six SQL files, ordered `0001`–`0006`.
- There is no root `package.json`, lockfile, test directory, conventional
  server entry point, or migration runner in the inspected repository.
- `.replit` declares Node.js 20 and web modules but does not supply an
  application server or a standard start command.
- `README.md` describes Hatchable deployment. It says the project includes
  seed data; the inspected migrations seed a plan row, while the separate
  demo UI hard-codes sample data. No persistent sample-school seed script was
  found.

## Hatchable and platform dependency search

The repository search found:

- Hatchable imports throughout the API handlers and in `lib/tenant.js`.
- Database calls through `db.query(...)` and `db.transaction(...)`.
- `config.get(...)` for bootstrap and Razorpay server secrets.
- `webhooks.verifyHmac(...)` for the Razorpay webhook, plus the runtime
  supplied `req.rawBody`.
- `req.user.id` and `req.user.email` as the source of authenticated identity.
- `access` and `methods` exports used by the current handler convention.
- `window.hatchable.auth` in the dashboard and login page. The login page calls
  `getSession`, `startLogin`, and `verifyCode`; the dashboard calls
  `getSession` and `signOut`.
- No implementation of those Hatchable SDK methods or of the API dispatch
  layer exists in this repository. The exact routing, authentication,
  raw-body, and error-handling behavior supplied by Hatchable must be confirmed
  from the platform or a running instance; it is not inferred here.
- No `DATABASE_URL`, mail-provider configuration, or session configuration
  is read directly by application code in this repository.

The API paths below are inferred from each file's location under `api/` and
the methods declared in that file. Confirm path dispatch and automatic
authentication behavior against Hatchable before relying on any undocumented
platform convention.

## API route inventory

### Identity — `api/me.js`

#### `GET /api/me`

- **Access declared:** authenticated user (`access = 'user'`).
- **Inputs:** identity comes from `req.user.id` and `req.user.email`; no query
  parameters or body are read.
- **Database operations:** upserts the authenticated email into
  `user_profiles`; looks up at most 25 pending invites matching
  `lower(email)`; for each invite, transactionally creates the membership and
  possibly a driver profile or guardian/student link, then marks the invite
  accepted; reads the profile, Super Admin membership, and active school
  memberships/subscription context.
- **Success response:** `{ user, isPlatformAdmin, memberships }`. The user
  object contains `id`, email, and the selected profile fields when present.
- **Observed behavior:** this profile read is also an invitation-acceptance
  and profile-email synchronization operation. An invite is accepted after
  an authenticated request whose identity email matches the invite email.

#### `PUT /api/me`

- **Access declared:** authenticated user.
- **Inputs:** `full_name` and `phone` from the request body.
- **Database operations:** upserts the current user's profile name and phone.
- **Success response:** `{ ok: true }`.
- **Frontend use:** no `PUT /api/me` call was found in `public/saas.js`.

### School creation — `api/schools/create.js`

#### `POST /api/schools/create`

- **Access declared:** authenticated user.
- **Inputs:** `name`, optional `contact_email` (defaults to authenticated
  email), optional `phone`, and `admin_name`.
- **Database operations:** checks existing active School Admin memberships;
  selects the active `school-standard` plan; generates a slug; transactionally
  inserts the school, profile, owner membership, and trial subscription; writes
  a school audit event.
- **Success response:** HTTP 201 with `{ school, trial_ends_at, message }`.
- **Authorization/business behavior:** permits school creation only when the
  user has no active School Admin membership according to this query; the
  creator is given a School Admin membership and a trial subscription.

### School data — `api/school/data.js`

#### `GET /api/school/data`

- **Access declared:** authenticated user; active school membership is required.
- **Inputs:** `school_id` query parameter.
- **School roles:** School Admin, Driver, or Parent.
- **Database operations and response vary by role:**
  - **School Admin:** returns the school, up to 200 vehicles, 200 routes, 300
    students, 200 drivers, 50 recent trips, and a current subscription summary.
  - **Driver:** requires an active driver record; returns the driver's active
    vehicle/route assignments, students on assigned routes, and up to 30 of
    the driver's trips. Subscription is `null`.
  - **Parent:** returns active students joined to guardian records for that
    user and school.
- **Success response:** role-specific school/workspace data object.

#### `POST /api/school/data`

- **Access declared:** authenticated School Admin only.
- **Inputs:** `school_id`, `type`, optional `action` (defaults to `create`),
  and fields appropriate to the type:
  - `vehicle`: `registration_number`, `label`, `capacity`.
  - `route`: `name`, `description`.
  - `student`: `full_name`, `grade`, `student_code`, optional `route_id`.
  - `assignment`: `vehicle_id`, `route_id`, and `driver_user_id`.
- **Database operations:** inserts the selected resource; student route
  assignment is an additional insert; assignment creation closes the current
  open assignment for that vehicle and inserts a new assignment; writes an
  audit event.
- **Success response:** HTTP 201 with `{ item }`.
- **Observed limitation:** only create is supported. There are no edit/delete
  operations in this handler. Student creation and route assignment are not
  wrapped together in one transaction.

### Invitations — `api/school/invite.js`

#### `GET /api/school/invite`

- **Access declared:** authenticated School Admin for the requested school.
- **Inputs:** `school_id` query parameter.
- **Database operations:** reads up to 100 invitations for that school.
- **Success response:** `{ invites }`.

#### `POST /api/school/invite`

- **Access declared:** authenticated School Admin for the requested school.
- **Inputs:** `school_id`, `email`, `role` (`driver` or `parent`), and
  `student_id` when role is parent.
- **Database operations:** validates that the selected parent student is
  active and in the same school; inserts or updates the pending invite;
  records an audit event.
- **Success response:** HTTP 201 with `{ invite, message }`.
- **Observed behavior:** this saves an invitation record; the handler does
  not send email. Membership creation is deferred until the invitee signs in
  with the matching email through the `GET /api/me` flow.
- **Schema difference:** the invite table allows `school_admin` as a role,
  while this endpoint accepts only `driver` and `parent`.

### School attendance history — `api/school/attendance.js`

#### `GET /api/school/attendance`

- **Access declared:** authenticated School Admin for the requested school.
- **Inputs:** `school_id` query parameter.
- **Database operations:** reads up to 300 attendance events for the school,
  joined to student, trip, and route display fields.
- **Success response:** `{ records }`.

### Trip management — `api/trips/manage.js`

#### `POST /api/trips/manage`

- **Access declared:** authenticated School Admin or Driver in `school_id`.
- **Inputs:** common `school_id`, `action`; for `start`, optional `route_id`,
  optional `vehicle_id`, and `trip_type` (`pickup` or `dropoff`, defaults to
  `pickup`); for `end`, `trip_id`.
- **Start database operations:** validates active route/vehicle when provided;
  for a Driver, requires active driver identity and a current matching
  vehicle/route assignment; inserts an active trip and writes an audit event.
- **End database operations:** finds the trip within the selected school;
  Drivers must own the trip; marks it completed, deletes its current-location
  row, and writes an audit event.
- **Success responses:** HTTP 201 `{ trip }` for start; `{ ok: true,
  status: 'completed' }` for end.
- **Observed limitations:** School Admins can start trips without a route or
  vehicle. Start/end and audit/location cleanup are separate operations rather
  than one transaction. No single-active-trip constraint is visible in the
  schema.

### Trip location — `api/trips/location.js`

#### `POST /api/trips/location`

- **Access declared:** authenticated Driver in the selected school.
- **Inputs:** `school_id`, `trip_id`, `latitude`, `longitude`, optional
  `accuracy_m`.
- **Database operations:** checks an active driver record and that the trip is
  active and assigned to that driver; reads the most recent current location
  to enforce a three-second interval; upserts current location and appends a
  history row.
- **Success response:** `{ ok: true, recorded_at }`.
- **Validation observed:** latitude and longitude are bounded; `accuracy_m`
  is coerced but not range-checked. The interval check is application-level
  and based on a read before writes.
- **Location model:** records server time, not a client timestamp. The UI
  sends GPS while its page remains active; background delivery is not assured.

### Trip attendance — `api/trips/attendance.js`

#### `POST /api/trips/attendance`

- **Access declared:** authenticated School Admin or Driver for the selected
  school.
- **Inputs:** `school_id`, `trip_id`, `student_id`, and `event_type`
  (`boarded`, `dropped_off`, or `absent`).
- **Database operations:** checks that trip is active and belongs to the
  school; checks that the active student has a current route assignment to the
  trip route; for a Driver, checks active driver identity and trip ownership;
  inserts or updates the unique `(trip_id, student_id, event_type)` row;
  writes an audit event.
- **Success response:** `{ attendance }`.
- **Observed behavior:** repeated events of the same type update the existing
  row; different event types for a student/trip can coexist, so contradictory
  transitions are not prevented by this handler or the unique constraint.

### Parent location — `api/parent/location.js`

#### `GET /api/parent/location`

- **Access declared:** authenticated Parent membership for the selected
  school.
- **Inputs:** `school_id` and `student_id` query parameters.
- **Database operations:** joins the selected school/student, guardian link,
  current route assignment, active trip, and latest current location.
- **Success response:** `{ trip_id, status, location }`; location is null when
  no fix is present, otherwise contains coordinates, accuracy, timestamp, and
  an `is_stale` flag set after 60 seconds.
- **Authorization observed:** the query constrains student, school, guardian
  user, and guardian school. No matching active trip returns 404.

### Platform administration

#### `GET /api/platform/overview` — `api/platform/overview.js`

- **Access declared:** authenticated user; explicitly checks platform-admin
  status.
- **Inputs:** none.
- **Database operations:** counts schools and subscription states, estimates
  monthly recurring revenue, counts failed webhooks, returns up to 100 school
  summaries and 20 recent audit events.
- **Success response:** `{ metrics, schools, recent_activity }`.

#### `POST /api/platform/school-status` — `api/platform/school-status.js`

- **Access declared:** authenticated platform admin.
- **Inputs:** `school_id`, `status` (`active`, `suspended`, or `archived`),
  optional `reason`.
- **Database operations:** updates a school status and writes an audit event.
- **Success response:** `{ school }`.

#### `POST /api/platform/billing-plan` — `api/platform/billing-plan.js`

- **Access declared:** authenticated platform admin.
- **Inputs:** monthly `provider_plan_id`, optional
  `provider_annual_plan_id`, and monthly/annual prices in integer paise.
- **Database operations:** updates the `school-standard` plan and writes an
  audit event.
- **Success response:** `{ plan }`.
- **Observed limitation:** this saves local plan IDs and display prices; it
  does not call Razorpay to verify plan amount, period, or currency.

#### `POST /api/platform/bootstrap` — `api/platform/bootstrap.js`

- **Access declared:** authenticated user.
- **Inputs:** `bootstrap_key`.
- **Database operations:** reads Hatchable `PLATFORM_BOOTSTRAP_KEY`, checks
  whether a platform admin exists, inserts the current user as admin with
  `ON CONFLICT DO NOTHING`, and writes an audit event.
- **Success response:** `{ ok: true, message }`.
- **Concurrency note:** migration `0005` adds a single-admin unique index,
  but the handler checks first and inserts separately. With concurrent
  requests, an insert conflict can be ignored while that request still
  returns success and writes an audit event. The database constraint prevents
  multiple rows; the handler does not report whether this request actually
  claimed the role.
- **Eligibility note:** the visible handler requires an authenticated user
  and the key; no further eligibility condition is implemented here.

### Billing and Razorpay

#### `POST /api/billing/checkout` — `api/billing/checkout.js`

- **Access declared:** authenticated School Admin for the selected school.
- **Inputs:** `school_id`, `interval` (`monthly` or `annual`, defaults to
  monthly).
- **Database operations:** checks for an existing subscription; reads local
  plan/plan ID and secrets from Hatchable config; calls the Razorpay
  subscriptions API; creates or updates the pending local subscription; writes
  an audit event.
- **Success response:** HTTP 201 with subscription ID, provider checkout URL,
  status, plan name, local amount, and optional customer ID.
- **Observed gaps:** no local provider-plan amount/currency verification; no
  checkout-result verification endpoint appears in the API inventory; request
  has no explicit timeout/retry policy; a provider error description may be
  returned in the response. Provider credentials are obtained through
  Hatchable config.

#### `POST /api/webhooks/razorpay` — `api/webhooks/razorpay.js`

- **Access declared:** public.
- **Inputs:** Razorpay signature and event ID headers, raw request body, event
  JSON. The handler requires Hatchable to provide `req.rawBody` and a webhook
  HMAC helper.
- **Database operations:** inserts or retries a webhook-event row; resolves a
  subscription by provider subscription ID, optionally falls back to
  `school_id` from signed entity notes; updates subscription status/period;
  upserts payment event data; marks webhook processed/failed.
- **Success response:** `{ received: true, duplicate: true }` for a previously
  non-failed event; otherwise `{ received: true, processed: true }`.
- **Observed behavior:** mapped subscription/payment event names update local
  state; unknown event types can still be marked processed.
- **Items to investigate during conversion:** event receipt and processing use
  multiple non-transactional operations; concurrent duplicate delivery/retry
  behavior needs explicit tests; payment-school attribution via notes needs
  review; failure summaries are stored and the message is logged. Keep
  provider signature verification over the exact raw bytes when replacing the
  Hatchable HMAC helper.

## Frontend pages, navigation, and API calls

### Current SaaS dashboard

`public/index.html` renders `#saasRoot` and loads `public/saas.js`. The client
uses `fetch` against same-origin `/api/...` URLs. It does not set
`credentials: 'include'` explicitly; the existing same-origin setup relies on
the browser's default same-origin credential behavior.

Observed calls from `public/saas.js`:

| UI action/view | API method and path | Body or query |
| --- | --- | --- |
| Load current profile | `GET /api/me` | None |
| Load platform workspace | `GET /api/platform/overview` | None |
| Load school workspace | `GET /api/school/data` | `school_id` query |
| Load School Admin people view | `GET /api/school/invite` | `school_id` query |
| Load School Admin attendance view | `GET /api/school/attendance` | `school_id` query |
| Create school | `POST /api/schools/create` | `name`, `contact_email`, `phone`, `admin_name` |
| Bootstrap Super Admin | `POST /api/platform/bootstrap` | `bootstrap_key` |
| Change platform school status | `POST /api/platform/school-status` | `school_id`, `status`, `reason` |
| Configure billing plan | `POST /api/platform/billing-plan` | provider plan IDs and paise prices |
| Create vehicle/route/student/assignment | `POST /api/school/data` | `school_id`, `type`, and type fields |
| Create invitation | `POST /api/school/invite` | `school_id`, `email`, `role`, optional `student_id` |
| Start/end trip | `POST /api/trips/manage` | `school_id`, action and trip fields |
| Send driver location | `POST /api/trips/location` | school/trip IDs and GPS fields |
| Record attendance | `POST /api/trips/attendance` | school/trip/student IDs and event type |
| Parent location lookup | `GET /api/parent/location` | `school_id`, `student_id` query |
| Start subscription checkout | `POST /api/billing/checkout` | `school_id`, interval |
| Sign out | Hatchable Auth SDK | `signOut()`; no application API endpoint |

The dashboard reads the current user's Hatchable session before making its
profile call. A missing SDK displays a Hatchable-specific sign-in error.
Unauthorized API errors are shown as a generic request error; there is no
distinct 401/403 handling or automatic login redirect in the API helper.

### Login page

`public/login.html` implements the visible email + six-digit code UI. It calls
Hatchable Auth `getSession()`, `startLogin({ email })`, and
`verifyCode({ email, code })`. The application contains no corresponding
server routes, code storage, delivery, expiry, rate limiting, or session
implementation. These behaviors are currently delegated to Hatchable and
cannot be inferred from this repository.

### Separate demo page code

`public/app.js` has sample routes, students, activity, client-only attendance
edits, CSV export, and placeholder notifications. It contains no API calls and
does not persist changes. The current `index.html` does not load it. Do not
mistake this code or its fake/sample records for the authenticated SaaS UI or
database seed data.

## Database migration inventory

The migrations use PostgreSQL SQL and `IF NOT EXISTS` for many objects. They
are schema scripts only; there is no migration tracking table or runner in the
repository. Ordering is numeric and required because later scripts alter
tables created earlier.

### `0001_commercial_saas.sql`

Creates the core tables:

- Tenancy and identity references: `schools`, `user_profiles`,
  `platform_admins`, `school_memberships`.
- Billing: `plans`, `subscriptions`, `payment_events`, `webhook_events`.
- School operations: `vehicles`, `drivers`, `routes`, `route_stops`,
  `students`, `guardians`, `student_guardians`,
  `student_route_assignments`, `vehicle_assignments`, `trips`,
  `current_trip_locations`, `trip_locations`, `attendance_records`.
- Audit and notification queue: `audit_logs`, `notification_events`.

Seeds a `school-standard` plan with a 14-day trial and default monthly/annual
prices. The provider plan ID is added by a later migration.

Notable constraints and indexes:

- School slugs and plan codes are unique.
- School membership is unique per `(school_id, user_id)`; roles are
  `school_admin`, `driver`, or `parent`.
- User IDs are plain `TEXT` references, not foreign keys to an application-owned
  identity table. `user_profiles`, `platform_admins`, membership, driver,
  guardian, audit, and attendance identity fields therefore depend on the
  external identity system.
- Vehicles, drivers, and students have per-school uniqueness rules.
- Subscription provider ID is unique; a partial unique index allows at most
  one subscription in the listed current states per school.
- Current location is one row per trip; location-history rows and current
  coordinates have latitude/longitude range checks.
- Attendance events are unique per `(trip_id, student_id, event_type)`.
- Many operational rows reference `school_id` and resource IDs separately;
  the schema does not use composite foreign keys to ensure a referenced
  student, route, vehicle, or trip has the same school ID. Handler-level
  checks and joins currently supply much of this tenant consistency.
- `student_guardians` links student and guardian IDs but does not itself
  constrain both records to the same school.
- Several deletes cascade school data, including student/route/vehicle/trip
  dependent records. Production deletion behavior must not be triggered by an
  automated migration/reset.
- Route stop coordinates and `accuracy_m` columns do not have coordinate
  accuracy bounds comparable to current GPS latitude/longitude checks.

Indexes cover common membership, subscription, school resource, trip,
location-history, attendance, and audit queries. No test schema or session
storage is created here.

### `0002_billing_provider.sql`

Adds `plans.provider_plan_id` and a plan description, then adds a partial
unique index over non-null provider plan IDs.

### `0003_school_invites.sql`

Creates `school_invites` with school cascade, optional student reference,
inviter ID, role/status checks, partial uniqueness for pending
`(school_id, email, role)`, and a lowercased-email/status index.

### `0004_annual_provider_plan.sql`

Adds `plans.provider_annual_plan_id` and a partial unique index for non-null
annual provider plan IDs.

### `0005_single_bootstrap_admin.sql`

Adds a unique expression index on `(true)` to limit `platform_admins` to one
row. It enforces a singleton table; application concurrency behavior still
needs to handle an ignored insert conflict correctly.

### `0006_profile_email.sql`

Adds `user_profiles.email` and a non-unique index on `lower(email)`. The index
does not enforce unique email-to-user mapping.

## Identity, role, and tenant model observed

- Hatchable supplies `req.user.id` and `req.user.email`; both are stringified
  and used in application queries. There is no local identity creation or
  password/code/session table.
- Platform-admin status is a row in `platform_admins`. School roles are rows
  in `school_memberships`. Drivers and guardians have their own per-school
  records; guardian/student links are in `student_guardians`.
- `requireSchoolRole` checks active membership, active school status, allowed
  role, and a subset of subscription state/grace-period conditions.
- School data and most school operations use that helper. Platform routes
  check `isPlatformAdmin` directly.
- The dashboard sends `school_id` from the selected membership in query
  parameters or request bodies. Handlers generally check membership in the
  database rather than trusting the browser value alone.
- `GET /api/me` uses authenticated email to attach pending invitations and
  create corresponding memberships. This makes verified email identity and
  its mapping into the new auth system a data-migration prerequisite.
- No database composite constraints guarantee that every related row's
  resource IDs share the declared school. During conversion, retain server
  authorization and consider forward-only constraints only after data
  compatibility is checked.
- Subscription enforcement is performed by application helper logic, not
  database constraints. When no subscription row exists, that helper does not
  reject the membership.

## Validation, persistence, and behavior gaps to carry into implementation

These are source observations to prioritize and test, not edits made by this
audit:

1. **External identity is foundational.** All protected handlers expect
   Hatchable-populated `req.user`; the auth provider is the only source of user
   identity. User IDs are not backed by an application-owned user table.
2. **Profile reads have side effects.** `GET /api/me` updates email and
   consumes pending invitations. The replacement should make this explicit and
   safely transactional/idempotent.
3. **Bootstrap has a concurrent-success edge case.** The unique index is
   protective, but an ignored conflicting insert is not checked before the
   handler returns success.
4. **Cross-school consistency partly depends on application code.** Several
   foreign keys do not include school ID; audit queries and add negative
   cross-tenant tests before changing those relationships.
5. **Multi-step writes are inconsistently transactional.** School creation and
   invite acceptance use `db.transaction`; student-plus-route creation,
   assignment replacement, trip ending/audit, and webhook processing use
   separate operations.
6. **Attendance is event-idempotent, not transition-enforced.** The unique key
   prevents a duplicate of the same event type but allows multiple event types
   for the same student and trip.
7. **GPS write limits are local read-before-write checks.** Accuracy is not
   bounded in the handler, and the three-second interval check may need
   atomic/rate-limit treatment under concurrent or multi-instance requests.
8. **Invitations do not send mail.** The endpoint saves the invitation and
   relies on the invitee to know to sign in with the exact email.
9. **Razorpay plan parity is not verified locally.** The admin route records
   IDs/prices without provider lookup; checkout trusts those IDs and returns a
   provider description on one error path.
10. **Webhook work is not atomic.** Signature verification depends on
    Hatchable-provided raw body/HMAC helpers; processing and retry idempotency
    need explicit transaction/concurrency tests in the replacement.
11. **Demo UI and SaaS UI coexist.** Only the SaaS page is loaded at `/`; the
    demo page is not evidence of persistent workflows.
12. **No application tests were found.** There are no tests, package scripts,
    server, or deployment configuration in the imported source to establish
    existing runtime behavior.

## Open questions before conversion

- Confirm Hatchable's path-dispatch rules for files under `api/`, automatic
  enforcement of `access = 'user'`, user identity guarantees, request-body
  parsing, and webhook raw-body behavior.
- Confirm whether the deployed Hatchable database can be exported under the
  user's authority and in what format; inspect actual data before designing
  identity mapping or production cutover.
- Confirm whether provider plan IDs, Razorpay credentials, webhook events, and
  a verified merchant account are configured outside the repository.
- Confirm the production email sign-in provider and sender/domain setup;
  `hatchable.toml` declares Hatchable email auth but contains no app-owned mail
  integration configuration.
- Confirm whether the product requires reliable locked-screen Android GPS;
  current UI explicitly describes foreground browser tracking and does not
  claim background delivery.
- Decide whether parent links may include multiple children by reusing one
  invite or whether one invite per child remains the product rule (the current
  UI says one invite per child).

## Audit boundary

No application source, migration, runtime configuration, or database was
changed during this audit. This inventory adds findings for the next staged
implementation; it does not certify the current application as production
ready.
