# Render build and deployment guide

This guide describes the development/staging deployment for the current
Hatchable-to-Render migration. It does not deploy services, create a database,
or move Hatchable data. Review Render's service plans and pricing before
applying the Blueprint; a Render PostgreSQL database is intentionally not
created automatically by `render.yaml`.

## Service layout

The Blueprint at the repository root defines two services, both pinned to the
`van-tracker` development branch:

| Service | Render type | Build command | Start/publish setting |
| --- | --- | --- | --- |
| `route-nest-api-dev` | Node.js Web Service | `npm ci` | `npm start`; health check `/health` |
| `route-nest-web-dev` | Static Site | `npm ci && npm run build:static` | Publish directory `dist` |

The static build copies `public/` into `dist/` and writes the public
`API_BASE_URL` into `runtime-config.js`. Do not put credentials or secrets in
that variable. Render supplies the API and frontend hostnames to the other
service through Blueprint service references.

The static site rewrites `/login` to `/login.html`; it deliberately has no
single-page-app catch-all. Its security headers include a Content Security
Policy with the API hostname expected for this Blueprint. If Render assigns a
different hostname or you add a custom domain, update the `connect-src` value
in `render.yaml` to match the actual API origin before deploying.

The backend allows only its own origin and the exact `FRONTEND_URL`. The
browser API client uses credentialed requests and CSRF tokens. Keep the frontend
and backend on the same site where possible; test cookies and sign-in on the
actual Render hostnames.

## Build and run locally

Requirements: Node.js 20 and a disposable PostgreSQL database.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL and replace the local SESSION_SECRET placeholder.
npm run db:migrate
npm run dev
```

The development server listens on port `5000` by default. Run
`npm run build:static` to produce `dist/`, `npm start` to run the production
server command locally, and `npm test` for the automated tests.

For local single-origin development, leave `API_BASE_URL` and `FRONTEND_URL`
unset. The browser then calls the API on the same origin. Email sign-in also
requires a configured Resend key and verified sender; without those values,
health checks can work but login-code delivery is disabled.

## Environment variables

### Backend Web Service

| Variable | Required when | Notes |
| --- | --- | --- |
| `NODE_ENV` | Always on Render | Set to `production`. |
| `PORT` | Supplied by Render | Do not set manually on Render. Local default is `5000`. |
| `DATABASE_URL` | Always | Internal URL for the Render staging PostgreSQL database. Keep it backend-only. |
| `SESSION_SECRET` | Always | At least 32 bytes. The Blueprint generates a value. |
| `DB_POOL_MAX` | Optional | Defaults to `8`; valid range `1`–`50`. Keep within the database connection limit. |
| `SESSION_MAX_AGE_SECONDS` | Optional | Defaults to `604800`; valid range `300`–`2592000`. |
| `FRONTEND_URL` | Split frontend/backend | Exact static-site origin. The Blueprint references the static service host. Do not use a wildcard. |
| `TRUST_PROXY_HOPS` | Optional | Defaults to `1` in production; valid range `0`–`5`. The Blueprint sets `1` for Render's proxy. |
| `AUTH_CODE_PEPPER` | Before enabling email sign-in | At least 32 bytes. The Blueprint generates a value. |
| `AUTH_CODE_TTL_SECONDS` | Optional | Defaults to `600`; valid range `60`–`1800`. |
| `AUTH_CODE_MAX_ATTEMPTS` | Optional | Defaults to `5`; valid range `1`–`10`. |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Optional | Defaults to `900`; valid range `60`–`86400`. |
| `AUTH_REQUEST_LIMIT_PER_EMAIL` | Optional | Defaults to `3`; valid range `1`–`20`. |
| `AUTH_REQUEST_LIMIT_PER_IP` | Optional | Defaults to `30`; valid range `1`–`500`. |
| `AUTH_VERIFY_LIMIT_PER_EMAIL` | Optional | Defaults to `10`; valid range `1`–`100`. |
| `AUTH_VERIFY_LIMIT_PER_IP` | Optional | Defaults to `60`; valid range `1`–`1000`. |
| `RESEND_API_KEY` | To deliver login codes | Secret; configure only on the backend. |
| `EMAIL_FROM` | With Resend | Sender address verified by Resend. |
| `PLATFORM_BOOTSTRAP_KEY` | Initial Super Admin claim only | Temporary secret. Remove it immediately after the first successful claim. |
| `RAZORPAY_KEY_ID` | When billing is enabled | Backend only. |
| `RAZORPAY_KEY_SECRET` | When billing is enabled | Secret; backend only. |
| `RAZORPAY_WEBHOOK_SECRET` | When signed webhooks are enabled | Secret; backend only. |

The Razorpay monthly and annual Plan IDs and display prices are stored through
platform billing-plan configuration; they are not environment variables.
Do not configure Razorpay values until merchant test-mode credentials, plans,
and webhook settings are ready.

### Static Site

| Variable | Required when | Notes |
| --- | --- | --- |
| `API_BASE_URL` | Split frontend/backend | Public API origin only. The Blueprint references the API service host and the static build writes it into `runtime-config.js`. Never put secrets here. |

Do not add `DATABASE_URL`, session/email secrets, bootstrap keys, or Razorpay
credentials to the Static Site.

## Staging setup

1. Push the migration branch to the connected Git repository. The current
   Blueprint is pinned to `van-tracker`; change both service `branch` fields
   together if the development branch is renamed.
2. Create a **new staging PostgreSQL database** in Render. Select its plan and
   region deliberately; put it in the same region as the API service. Do not
   connect the Hatchable database or any production database.
3. In Render, create a Blueprint from this repository and review every resource,
   hostname, and plan before applying it. Supply the staging database's internal
   connection URL for the backend `DATABASE_URL`.
4. Add `RESEND_API_KEY` and `EMAIL_FROM` to the backend service to enable
   sign-in-code delivery. Verify the sender with Resend first. Keep all secret
   values in Render's environment settings, not in chat, Git, or the Static Site.
5. If claiming the initial Super Admin, set `PLATFORM_BOOTSTRAP_KEY` on the
   backend, sign in, claim the role, then remove the variable and redeploy.
6. Apply the ordered migrations explicitly to the staging database with
   `npm run db:migrate` from a trusted environment configured for that staging
   `DATABASE_URL`. The runner is not attached as a Render pre-deploy command:
   review the target before any schema change. There are eight migrations in
   the repository as of this guide.
7. Verify `/health`, email sign-in, session refresh/logout, all user roles,
   tenant isolation, billing test-mode behavior, and desktop/mobile UI on the
   deployed hostnames. Check browser and service logs for errors and sensitive
   values.

Do not deploy this Blueprint as a production cutover. Existing Hatchable data
transfer is a separate operation requiring an authorized export, backup,
identity mapping, staging validation, rollback plan, and explicit approval.

## Render references

- [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
- [Render Blueprints / Infrastructure as Code](https://render.com/docs/infrastructure-as-code)
- [Render deploys and build commands](https://render.com/docs/deploys)
