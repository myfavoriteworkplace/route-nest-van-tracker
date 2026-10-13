# School Van Tracker: Hatchable-to-Render Migration Plan

## Purpose and scope

This document is the implementation plan for converting the imported School
Van Tracker from a Hatchable-hosted project to a conventional application
deployable on Render. It is a plan, not a claim that the migration, source
audit, database transfer, or deployment has already happened.

The migration should retain the existing product, UI, routes, data model, and
business rules wherever safe. It must replace runtime services supplied by
Hatchable with explicit application-owned services. Do not rewrite the product
from scratch, deploy the current unconverted source as if it were ready, or
modify/delete the existing Hatchable project or its data.

### Current progress — 2026-10-13

- **Phase 1 (source audit): complete.** See
  [`migration-inventory.md`](migration-inventory.md) for the original API,
  authentication, frontend, and schema inventory.
- **Phase 2 (Node.js/PostgreSQL foundation): implemented and locally checked.**
  The repository now has a Node 20 package manifest and lockfile, an Express
  server, bounded `pg` pool, readiness endpoints, static-file hosting, and an
  explicit transactional migration runner with a migration ledger, checksums,
  and an advisory lock. Automated checks currently pass (6 tests).
- The workspace's preconfigured **Replit development PostgreSQL** answered a
  read-only `SELECT 1` readiness check. It is not the intended Render database;
  no schema migrations were run against it.
- **Still blocked on target configuration:** a Render PostgreSQL instance and
  its `DATABASE_URL` have not been supplied. Therefore the existing six SQL
  migrations have not been applied or verified against the intended Render
  database.
- The generated package lock currently contains Replit package-firewall
  download URLs. A clean dependency install on Render has not been tested; make
  the lock/build configuration portable before treating a Render build as
  verified.
- The existing login contains inline JavaScript, so Helmet's Content Security
  Policy is temporarily disabled while its other default security headers are
  enabled. Revisit the policy after replacing Hatchable auth. The current
  static UI and API are same-origin; configure a narrow CORS allowlist if they
  are split into separate Render services.
- The Hatchable authentication flow and business API handlers remain
  Hatchable-dependent. This foundation does not make sign-in or protected
  dashboard workflows Render-ready, and no Render deployment has been created.

### Imported repository baseline

The imported repository currently contains:

- `public/`: the static dashboard and login pages, JavaScript, and styles.
- `api/`: individual API handlers, including school, trip, parent, platform,
  billing, and webhook handlers.
- `lib/tenant.js`: tenant-related helper code.
- `migrations/`: six SQL migrations.
- `hatchable.toml`: Hatchable auth and secret declarations.
- `README.md`: Hatchable-oriented project instructions.

At the start of the source audit, there was no root `package.json` or
conventional Node.js server entry point. Phase 2 has since added the Node.js
and Express foundation described in the current-progress section. The source
audit establishes the repository contracts and schema but does not verify
undocumented Hatchable runtime behavior, existing production data, or provider
configuration.

### Intended deployment shape

| Component | Target |
| --- | --- |
| Browser UI | Existing plain HTML, CSS, and JavaScript on a Render Static Site |
| API | Node.js/Express Render Web Service |
| Persistent data | Render PostgreSQL, or another explicitly selected PostgreSQL service |
| Authentication | Application-owned email sign-in and server-managed sessions |
| Billing | Server-side Razorpay subscriptions and verified webhooks |
| Source | Existing GitHub repository; validate on a migration branch before approval to merge |

The preferred deployment is a separate static frontend and API service. If a
single-origin arrangement is selected instead, document the reason and its
operational trade-offs before implementation.

## Non-negotiable migration principles

1. **Audit before refactoring.** Inventory the real source and behavior before
   deciding how to replace Hatchable services.
2. **Preserve product behavior.** Keep the existing UI and user journeys unless
   a verified security or correctness issue requires a documented change.
3. **Treat identity and tenant boundaries as security controls.** A browser
   supplied school ID or role is never proof of access.
4. **Keep secrets server-side.** No database, session, bootstrap, or Razorpay
   secret may enter static assets, browser responses, source control, or logs.
5. **Do not fabricate production readiness.** Missing provider configuration,
   unavailable Hatchable data, incomplete end-to-end tests, and foreground-only
   location tracking must be stated honestly.
6. **Keep Hatchable and its data intact during migration.** No production
   cutover, destructive database operation, merge to `main`, or production
   deploy without explicit approval.
7. **Use small, reviewable stages.** Each stage has a verification gate. Do not
   proceed past a failed security or persistence gate by substituting demo data.

## Phase 1 — Source audit and implementation inventory

**Goal:** Replace assumptions with facts from this repository before major code
changes.

### Audit work

- Read every handler and helper under `api/` and `lib/`, all public HTML,
  JavaScript, and CSS files, and all six migrations in numeric order.
- Search the complete repository for Hatchable imports and runtime calls,
  including `window.hatchable`, `hatchable.auth`, `db.query`, `auth.getUser`,
  `auth.requireUser`, `config.get`, and platform-specific request/response
  helpers or environment configuration.
- Record every API URL, method, request shape, response shape, current auth
  assumption, authorization check, and database operation.
- Follow each UI navigation path and list the API calls the page makes.
- Record how identity is obtained in each handler and whether IDs originate
  from Hatchable-managed accounts.
- Trace tenant and school isolation for reads and writes. Identify checks done
  by the server versus checks implied only by the UI.
- Document database tables, foreign keys, unique constraints, indexes,
  migration dependencies, and any destructive SQL.
- Mark features as implemented, incomplete, demo-only, externally configured,
  or unclear; in particular, do not assume billing or authentication is
  complete merely because routes exist.
- Record test coverage and manual steps needed to confirm actual behavior.

### Required output and gate

Create `docs/migration-inventory.md` from the findings before large refactors.
It should link each old handler to its target route and capture any intentional
contract change. Every uncertain behavior should be labelled as uncertain and
investigated, not silently guessed.

**Gate:** No framework-wide rewrite or auth/data migration begins until the
inventory exposes the current identity model, route contracts, schema
relationships, and tenant checks.

**Status:** Complete. `docs/migration-inventory.md` records the source audit;
the audit is a repository inspection and not a live Hatchable runtime test.

## Phase 2 — Establish the Node.js and PostgreSQL foundation

**Goal:** Make a small, observable Express application with persistent
PostgreSQL access and safe schema migrations.

### Application foundation

- Add a root `package.json` and committed lockfile with a stable Node.js engine,
  compatible maintained packages, and `start`, `dev`, `test`, and `db:migrate`
  scripts.
- Add an Express server that listens on `0.0.0.0` and `process.env.PORT`.
- Configure JSON/form parsing, security headers, request logging that excludes
  sensitive values, route registration, and centralized error handling.
- Add `GET /health` for Render. It should report readiness only when the
  dependencies needed to serve requests are ready; if database access is
  required, check it rather than returning a permanently healthy response.
- Optionally add `GET /api/health` for API diagnostics without exposing
  infrastructure details.
- Ensure production error responses do not reveal stack traces, SQL,
  credentials, or internal connection details.

### PostgreSQL and migrations

- Use `pg` and a shared, bounded connection pool configured from `DATABASE_URL`.
- Set sensible connection and idle timeouts; parameterize all user-influenced
  SQL values.
- Release clients reliably and close the pool during graceful shutdown.
- Keep SQL and data-access responsibilities separable from HTTP response code
   where practical; do not add an ORM solely for this migration.
- Implement an explicit migration runner with a schema-version table. Apply
  unapplied migrations in deterministic order, record success, use one
  transaction per migration when supported, and stop with a clear error on
  failure. Never re-run a successful migration or reset/drop production data.
- Inspect all existing SQL for Hatchable-specific behavior and PostgreSQL
  compatibility before using it against Render.
- Keep the existing migration files and their ordering unless the audit
  establishes a reason to add a forward-only migration.

**Gate:** With valid local configuration, the service starts, PostgreSQL can
be reached, migrations run against a disposable database, and `/health`
reflects readiness. A missing required variable fails clearly without printing
its value.

**Implementation update:** The local application and unit checks are in place.
`npm test` passes 6 tests, the server starts on `0.0.0.0:$PORT`, and the
workspace PostgreSQL readiness query succeeded. That connection is the
Replit-managed development database, not Render PostgreSQL, and it was only
used for `SELECT 1`. The six project migrations were not run. The Phase 2 gate
remains open until the runner is validated against a disposable PostgreSQL
database and the intended Render database is explicitly configured.

## Phase 3 — Independent identity, sessions, and authorization

**Goal:** Remove the Hatchable identity dependency without weakening account,
role, or tenant security.

### Email authentication

- Replace Hatchable login/session calls with an application-owned email login
  flow compatible with the current login experience.
- Select and configure a real email provider through a provider adapter. Keep
  local-only mail behavior clearly isolated from production.
- Make codes or links one-time, expiring, and resistant to brute-force abuse.
- Rate-limit issuance and verification. Return generic responses so the
  endpoint does not disclose whether an email has an account.
- Use server-managed sessions with PostgreSQL-backed session storage in
  production; do not use Express's in-memory session store in production.
- Regenerate the session on authentication; implement expiry, logout,
  HttpOnly cookies, production `Secure`, and an appropriate `SameSite` policy.
- Protect cookie-authenticated state-changing operations against CSRF.
- Never log login codes, session IDs/cookies, tokens, or credentials.

### Identity and roles

Preserve the existing experiences and permissions for:

- Platform Super Admin
- School Admin
- Driver
- Parent/guardian

Use the existing database model where it is compatible. If Hatchable currently
owns user identities, document and implement an explicit mapping from legacy
identity/profile records to application-owned identities. A legacy user ID is
not automatically the ID of the new identity. Never grant a privileged role
based only on an email address or a client-provided role field.

Preserve the one-time Super Admin bootstrap intent using
`PLATFORM_BOOTSTRAP_KEY`. Require an authenticated and eligible account; claim
the privilege atomically in PostgreSQL so concurrent attempts cannot create
multiple Super Admins; never send the secret to the browser. Document secure
initial setup, rotation, and disabling after the bootstrap is complete.

### Tenant authorization

Implement shared server-side checks for authentication, platform-admin
privileges, school membership and role, driver-to-trip assignment, and
guardian-to-student relationship. Derive identity from the verified session,
then retrieve authoritative permissions from the database for the requested
resource. Do not authorize based solely on request bodies, URL parameters,
hidden UI controls, or browser storage.

**Gate:** Tests prove anonymous access is rejected, roles are respected, a
School A account cannot read or mutate School B data, a driver cannot update an
unassigned/ended trip, a parent cannot access an unlinked student, and the
bootstrap cannot be claimed twice.

## Phase 4 — Convert API handlers while preserving contracts

**Goal:** Move every existing handler behind Express while retaining URLs and
business behavior where practical.

The inventory is the source of truth for request/response contracts. The
following URLs are the expected compatibility targets based on the provided
migration requirements; verify each against the actual existing source before
implementing it.

| Area | Expected routes | Core checks |
| --- | --- | --- |
| Identity | `GET /api/me` | Authenticated profile, memberships, and role context; anonymous is `401`, never a fabricated user |
| Schools | `POST /api/schools/create`; `GET/POST /api/school/data`; `GET/POST /api/school/invite`; `GET /api/school/attendance` | Validate payloads; enforce school membership and role on every read/write |
| Trips | `POST /api/trips/manage`; `POST /api/trips/location`; `POST /api/trips/attendance` | Verify active trip and driver assignment; validate coordinates/times; reject ended-trip GPS |
| Parent | `GET /api/parent/location` | Verify guardian/student relationship; return authorized latest location and staleness |
| Platform | `GET /api/platform/overview`; `POST /api/platform/school-status`; `POST /api/platform/billing-plan`; `POST /api/platform/bootstrap` | Platform-admin-only; do not expose school/student data to ordinary school roles |
| Billing | `POST /api/billing/checkout`; `POST /api/webhooks/razorpay` | School-level subscription; server-side provider validation; verified, idempotent events |

For every route:

1. Preserve its method and URL where possible; document unavoidable changes.
2. Validate input on the server and use parameterized SQL.
3. Apply authentication, role, resource ownership, and tenant checks before
   returning or mutating data.
4. Use transactions for multi-record operations that must be atomic.
5. Return appropriate status codes and a consistent JSON error shape.
6. Add tests for success, invalid input, anonymous access, and cross-tenant
   access where applicable.
7. Update the migration inventory with final behavior and test evidence.

Trip logic must preserve valid start/end and boarding/drop-off/absence
transitions, and reject or idempotently handle duplicate/invalid transitions.
GPS submissions should be validated, rate-limited, and accepted only for an
authorized active trip. Parent location responses must not be retrievable for
another family or school by changing an identifier.

**Gate:** No route is left calling the Hatchable runtime; route contracts and
security tests match the inventory.

## Phase 5 — Reconnect the current frontend

**Goal:** Preserve the visual design and navigation while moving API and
authentication calls to the new service.

- Remove `window.hatchable` usage from the frontend, especially authentication
  and sign-out flows.
- Add a small API client that uses a configurable public API base URL, sends
  cookies with `credentials: 'include'` when needed, and handles `401`, `403`,
  validation failures, and server errors consistently.
- Redirect unauthenticated users through the new login flow and use the
  backend logout endpoint.
- Do not replace failed API responses with demo data. Surface a clear error
  state rather than implying saved/live data exists.
- Keep the API base URL public configuration only. Static-site environment
  variables do not necessarily rewrite already-published JavaScript; choose a
  build-time public setting or a runtime configuration endpoint and document
  it. Never place secrets in either mechanism.
- Configure CORS for the exact production frontend origin only. Credentialed
  requests must not use wildcard origins.
- Verify session-cookie and CSRF behavior on the actual deployed hostnames.
  Separate static and API hostnames may require careful `SameSite`, `Secure`,
  origin, and CSRF configuration; test rather than assuming browser behavior.
- Preserve the existing login, platform admin, school admin, driver, parent,
  attendance, invite, assignment, billing, and mobile layouts.

**Gate:** Every frontend API call targets the selected API base URL, login and
logout use the independent auth service, no demo fallback masks API failure,
and the UI still renders correctly at desktop and mobile sizes.

## Phase 6 — Complete and verify Razorpay billing

**Goal:** Treat billing as a server-verified provider integration, not a
successful browser redirect.

- Create checkout/subscription requests on the server for monthly and annual
  school plans; retain the existing one-subscription-per-school model.
- Configure the intended Razorpay plan identifiers and validate that plan
  identifiers, billing periods, and amounts match the application’s configured
  plans.
- Verify checkout results server-side before updating subscription state.
- Verify webhook signatures against the raw request body using
  `RAZORPAY_WEBHOOK_SECRET`.
- Store provider event identifiers and process events idempotently.
- Handle successful and failed payments, cancellations, renewals, and status
  transitions. Persist provider subscription/payment identifiers as required.
- Keep `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
  `RAZORPAY_WEBHOOK_SECRET` on the backend only.
- Disable checkout with a clear configuration error when required credentials
  or plan IDs are absent; never simulate a successful payment.
- Document Razorpay dashboard setup, the webhook URL/events selected, test-mode
  instructions, and the controlled production setup.

**Gate:** Tests cover invalid signatures, duplicate events, failed payments,
renewals, cancellations, and state transitions. A browser redirect alone
cannot activate a subscription.

## Phase 7 — Test and prepare Render staging

**Goal:** Prove the migrated app on disposable/staging services before any
production data movement or cutover.

### Automated test coverage

Use a maintained test runner and Express HTTP test tooling with an isolated
test database. Required areas:

- Startup/configuration, health readiness, unknown routes, and safe error
  responses.
- Login, invalid/expired/reused codes, logout, session expiry, and rate limits.
- Anonymous rejection, each role’s expected access, cross-school reads and
  writes, parent-child isolation, and driver-trip assignment.
- School, vehicle, route, student, invitation, and assignment operations.
- Trip start/end, valid and invalid GPS updates, attendance events, and history.
- Authorized parent location and stale-location behavior.
- Billing creation, invalid webhook signatures, duplicate-event idempotency,
  and subscription status transitions.

Never point automated tests at production data or mutate the existing
Hatchable database.

### Render service settings

Create and validate a `render.yaml` Blueprint if the supported Blueprint
syntax fits the selected service arrangement; otherwise document the dashboard
configuration explicitly.

**Backend Web Service**

- Repository: existing GitHub repository.
- Root directory: repository root.
- Migration branch: `migration/render-deployment` during validation; move to
  `main` only after review and explicit approval.
- Build command: `npm ci`.
- Start command: `npm start`.
- Health-check path: `/health`.
- Set `NODE_ENV=production`.
- Set `DATABASE_URL` from the Render PostgreSQL service using the appropriate
  internal connection information.
- Configure remaining secret values securely in Render, not in Git.

**Frontend Static Site**

- Repository and validation branch: same as backend.
- Publish directory: `public`.
- Build command: empty if the existing frontend remains plain static
  HTML/CSS/JavaScript.
- Set the selected public API URL using the documented frontend configuration
  mechanism.
- Add a fallback only if required by the existing page routes; do not impose an
  SPA rewrite that breaks `login.html` or other direct page paths.

**PostgreSQL**

- Provision a staging database first.
- Keep the service and database in the same Render region where practical.
- Run explicit migrations against staging and confirm their results.
- Do not make startup silently reset or destructively alter a database.

### Environment-variable inventory

The final `.env.example` should contain placeholder names and descriptions,
never usable credentials. Likely variables include:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode |
| `PORT` | HTTP listen port; supplied by Render |
| `DATABASE_URL` | PostgreSQL connection |
| `SESSION_SECRET` | Server-side session signing |
| `FRONTEND_URL` | Exact allowed frontend origin |
| `API_BASE_URL` | Public API URL if needed by static frontend configuration |
| `PLATFORM_BOOTSTRAP_KEY` | One-time initial platform-admin bootstrap |
| `RAZORPAY_KEY_ID` | Server-configured Razorpay key identifier |
| `RAZORPAY_KEY_SECRET` | Server-only Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | Server-only webhook verification secret |
| Email-provider settings | Required by the selected production sign-in provider |

Validate mandatory settings at startup and report missing *names*, never
secret values. `.gitignore` must exclude `.env`, local secrets, dependencies,
logs, coverage output, temporary files, and database dumps while allowing
`.env.example`.

### Manual staging acceptance checklist

Run and record the outcome of each step:

1. Initialize the staging database and apply all six existing migrations in
   order.
2. Bootstrap exactly one Super Admin using the documented secure process.
3. Sign in, refresh, and sign out.
4. Create a school; confirm the creator receives only the intended role.
5. Create a vehicle, route, and student; create driver/parent invitations and
   assignments.
6. Sign in as a driver, start a trip, submit GPS, and confirm it persists.
7. End the trip and confirm later GPS updates are rejected.
8. Record boarding and drop-off/absence events; inspect attendance history.
9. Sign in as a linked parent and verify the correct child’s location.
10. Attempt to access an unlinked child and another school; confirm denial.
11. Verify platform controls are unavailable to ordinary accounts.
12. Exercise Razorpay test-mode checkout, valid and invalid webhooks, and
    duplicate webhook delivery.
13. Test navigation, refresh behavior, and responsive layouts on desktop and
    mobile.
14. Restart the backend and confirm persistent data and sessions behave as
    documented.
15. Review service logs and browser console for errors and accidental sensitive
    information.

Do not describe the service as production-ready until critical journeys,
authorization tests, webhook verification, and staging deployment have
passed.

## Existing data and production cutover

Treat a fresh Render database and migration of existing Hatchable data as two
separate operations.

### Fresh installation

1. Create a new staging PostgreSQL database.
2. Apply the ordered migrations with the explicit runner.
3. Seed only documented, non-production demo/test data if needed.
4. Verify schema and application behavior without connecting to production data.

### Existing-data migration

Before attempting a transfer:

- Confirm that an authorized, permitted export from Hatchable is available.
  If it is not, state that production data migration cannot yet be completed.
- Back up the source data in a recoverable form and verify the backup.
- Map schools, memberships, users, roles, students, guardians, trips,
  attendance, and billing relationships.
- Design identity mapping explicitly; do not assume Hatchable IDs are valid
  application identities.
- Exclude credentials, passwords, sessions, and provider secrets from ordinary
  data exports/imports.
- Import into a separate staging database, validate row counts and foreign-key
  relationships, and compare key business totals.
- Plan a controlled cutover window, final delta handling if needed, and a
  tested rollback to the untouched Hatchable service/data.

Do not delete, modify, or stop the existing Hatchable project as part of
staging. Do not migrate or cut over live data without an explicit backup,
reviewed plan, and approval.

## Product limitations and open risks

- **Source behavior is not yet audited.** The route list and replacement design
  must be checked against the actual handlers and frontend before implementation.
- **Email sign-in needs a real provider.** Production authentication cannot be
  claimed complete without provider setup and end-to-end verification.
- **Legacy identity mapping may block data transfer.** Access to identity
  records and supported export formats must be confirmed.
- **Razorpay needs merchant configuration.** Plan IDs, credentials, webhook
  events, and test-mode behavior must be supplied and validated.
- **Cross-origin cookies are deployment-sensitive.** Validate actual domains,
  browser cookie policy, CORS, and CSRF protection in staging.
- **Foreground GPS is not guaranteed background tracking.** Browser
  geolocation may pause when an Android device is locked or the browser is
  suspended. Test on real driver devices before promising continuous tracking;
  reliable background tracking may require a separate product/mobile-app
  design.
- **Render deployment is not a substitute for security testing.** Passing a
  build or health check alone does not prove tenant isolation, billing safety,
  or production readiness.

## Suggested implementation sequence and deliverables

1. **Audit:** `docs/migration-inventory.md`, route matrix, auth/data-flow map,
   schema notes, and open questions.
2. **Backend foundation:** package/lockfile, Express server, PostgreSQL pool,
   health endpoints, and safe migration runner.
3. **Auth and access controls:** independent email auth, durable sessions,
   identity mapping, bootstrap flow, and security tests.
4. **API conversion:** all routes, validation, tenant checks, and endpoint
   tests.
5. **Frontend connection:** independent login/logout, configured API client,
   error handling, CORS/cookies/CSRF, and visual regression checks.
6. **Billing:** verified checkout/webhooks, idempotency, plan configuration,
   and test-mode guide.
7. **Staging:** Render services, environment configuration, staging database,
   migration run, automated tests, and manual acceptance checklist.
8. **Review and approval:** report changed files, implementation decisions,
   test evidence, remaining limitations, required credentials/configuration,
   and data-cutover risks. Do not merge into `main` or deploy production
   without explicit approval.

The task is complete only after the application works on Render staging with
persistent PostgreSQL data, no required runtime dependency on Hatchable, and
critical authentication, tenant-isolation, billing, and user-journey checks
passing. Any unmet item must be reported as incomplete rather than implied to
be finished.
