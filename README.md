# School Van Tracker

A parent and school dashboard for school-van location, arrival alerts, and
student attendance. This repository is being migrated from Hatchable to a
standard Node.js/Express and PostgreSQL application for Render.

## Current migration status

The Express server, PostgreSQL connection pool, readiness endpoints, and
versioned SQL migration runner are in place. The local migration path has been
verified: all seven migrations applied to a temporary PostgreSQL database, a
repeat run applied none, and all six automated tests pass. Independent
authentication modules and their schema were added, but they are not yet
connected to the Express app. Existing Hatchable login and business API
handlers have **not** been migrated. The app is not ready for Render staging
or production.

See:

- [Hatchable-to-Render migration plan](docs/hatchable-to-render-migration.md)
- [Source audit and route/schema inventory](docs/migration-inventory.md)

## Local development

Requirements: Node.js 20 and a PostgreSQL database.

1. Install dependencies with `npm install`.
2. For local development outside Replit, copy `.env.example` to `.env` and set
   `DATABASE_URL` to a development PostgreSQL database. Keep real credentials
   out of source control.
3. Apply the existing schema with `npm run db:migrate`.
4. Start the app with `npm run dev` (or `npm start`).
5. Run the automated checks with `npm test`.

**Database safety:** This Replit workspace has its own managed development
database in `DATABASE_URL`; it is not the Render target. Before running
`npm run db:migrate`, explicitly configure the connection to a disposable
external PostgreSQL database. Do not use the Hatchable or production database.

The server listens on `0.0.0.0` and uses `PORT` when supplied, defaulting to
5000. `GET /health` and `GET /api/health` return `503` until PostgreSQL is
reachable. The migration command only applies unapplied files in `migrations/`;
it does not reset or delete data.

## Important migration boundaries

- Existing `api/` handlers and browser authentication still depend on Hatchable.
- No Render database has been configured or migrated by this code. The lockfile
  also contains Replit package-firewall URLs, so dependency installation on
  Render is not yet verified.
- Do not point the migration runner at the current Hatchable production database
  or a Render production database until the migration and data-transfer plan is
  reviewed and explicitly approved.
