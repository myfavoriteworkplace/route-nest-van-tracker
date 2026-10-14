# School Van Tracker

A parent and school dashboard for school-van location, arrival alerts, and
student attendance. This repository is being migrated from Hatchable to a
standard Node.js/Express and PostgreSQL application for Render.

## Current migration status

The Express server, PostgreSQL pool, readiness endpoints, versioned migration
runner, independent email-auth routes, and converted business API are in place.
The dashboard now uses the application session and CSRF-protected API client.
The root `render.yaml` and [Render build/deployment guide](docs/render-deployment.md)
describe a split Static Site and Web Service deployment. No Render database or
services have been created, and no Hatchable production data has been moved.
Staging authentication, tenant-isolation, billing, and full user journeys still
need end-to-end verification before production use.

See:

- [Hatchable-to-Render migration plan](docs/hatchable-to-render-migration.md)
- [Source audit and route/schema inventory](docs/migration-inventory.md)
- [Render build commands, environment, and deployment configuration](docs/render-deployment.md)

## Local development

Requirements: Node.js 20 and a PostgreSQL database.

1. Install the exact locked dependencies with `npm ci`.
2. For local development outside Replit, copy `.env.example` to `.env` and set
   `DATABASE_URL` and a unique `SESSION_SECRET` (at least 32 bytes). Keep real
   credentials out of source control.
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

- No Render database has been configured or migrated by this code. The lockfile
  uses public npm registry URLs; a clean Render build and staging deployment
  still need to be verified.
- Production sign-in requires a real email provider, and production billing
  requires configured Razorpay plans, credentials, and webhook validation.
- Do not point the migration runner at the current Hatchable production database
  or a Render production database until the migration and data-transfer plan is
  reviewed and explicitly approved.
