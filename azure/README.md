# Azure production handoff

The application is prepared for a split Azure deployment. Deploy only after the
final product and billing configuration are approved.

## Recommended resources

1. Azure Static Web Apps for `frontend`.
2. Linux Azure App Service (Basic B1 or higher) for `backend`.
3. Azure Database for PostgreSQL Flexible Server in the same region as App Service.
4. Application Insights and Log Analytics for backend failures, latency, and WebSocket health.
5. General-purpose v2 Storage account with a private `practice-tapes` container.

For Sri Lanka, benchmark South India, Central India, and Southeast Asia before
choosing the production region. Keep the API and database together.

## Backend App Service settings

Configure the startup command as `bash startup.sh`. Enable WebSockets, HTTPS
Only, Always On, health check path `/health/ready`, and a 64-bit worker. The
container's own probe uses `/health/live`, which intentionally does not query
the database. Add these
application settings in App Service or Key Vault:

```text
APP_ENV=production
APP_VERSION=<release-or-git-sha>
LOG_LEVEL=INFO
APPLICATIONINSIGHTS_CONNECTION_STRING=<secret>
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
SECRET_KEY=<at-least-32-random-bytes>
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_DAYS=30
RATE_LIMIT_HASH_KEY=<separate-random-secret>
RATE_LIMIT_WRITE_REQUESTS=300
RATE_LIMIT_WRITE_WINDOW_SECONDS=300
WS_MAX_MESSAGE_BYTES=262144
WS_MAX_MESSAGES_PER_SECOND=60
WS_MAX_SESSION_SECONDS=900
CORS_ORIGINS=https://YOUR-FRONTEND.azurestaticapps.net,https://YOUR-DOMAIN
FRONTEND_URL=https://YOUR-DOMAIN
EMAIL_PROVIDER=azure
AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING=<secret>
AZURE_EMAIL_SENDER=security@YOUR-DOMAIN
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=<secret>
PAYPAL_CLIENT_SECRET=<secret>
PAYPAL_WEBHOOK_ID=<secret>
PAYPAL_STARTER_PLAN_ID=<live-plan-id>
PAYPAL_PRO_PLAN_ID=<live-plan-id>
PAYPAL_ELITE_PLAN_ID=<live-plan-id>
PAYPAL_RECONCILE_BATCH_SIZE=200
TAPE_STORAGE_MODE=azure
TAPE_STORAGE_ACCOUNT_URL=https://YOUR-STORAGE.blob.core.windows.net
TAPE_STORAGE_CONTAINER=practice-tapes
TAPE_MAX_BYTES=16777216
TAPE_MAX_FRAMES=9000
TAPE_RETENTION_DAYS=90
TAPE_PRUNE_BATCH_SIZE=200
CONTACT_RETENTION_DAYS=365
AUTH_RECORD_RETENTION_DAYS=30
WEB_CONCURRENCY=2
FORWARDED_ALLOW_IPS=*
RUN_DB_MIGRATIONS=false
RUN_CATALOG_SYNC=false
```

Never add production values to Git.

Production logs are structured JSON and include an `X-Request-ID` correlation
value. The API does not log request bodies, query strings, credentials, email
addresses, or raw exception text. Preserve `X-Request-ID` when a gateway or
frontend reports a failure.

`FORWARDED_ALLOW_IPS=*` is appropriate only behind the Azure App Service
reverse proxy. Do not use it when the backend is directly reachable, because
untrusted forwarded addresses would weaken IP-based abuse controls. The shared
rate-limit buckets live in PostgreSQL and therefore apply across every worker
and App Service instance.

Run `python -m alembic upgrade head` as a single pre-deployment release step.
Then run `python -m scripts.sync_technique_catalog` once to apply the reviewed
technique packages.
Do not enable `RUN_DB_MIGRATIONS` on multiple production instances because two
containers could attempt the same migration concurrently. For a database created
before Alembic, first follow the validated adoption procedure in
`backend/MIGRATIONS.md`.

Configure the PayPal webhook URL as
`https://YOUR-API/subscription/webhooks/paypal` and subscribe to the supported
subscription lifecycle and payment-sale events. The webhook ID must match
`PAYPAL_WEBHOOK_ID`; an application/client ID is not a webhook ID.

Run `python -m scripts.reconcile_paypal_subscriptions` from the `backend`
directory every six hours as a separate scheduled job (for example, an Azure
WebJob or Azure Container Apps Job). Keep it single-instance. The command exits
non-zero when any record could not be reconciled so Azure monitoring can alert;
provider outages do not revoke a member's last known access state.

Enable the App Service system-assigned managed identity and grant it **Storage
Blob Delegator** plus **Storage Blob Data Contributor** on the tape Storage
account. Keep the container private. Configure Blob service CORS for only the
production frontend origins, method `PUT`, allowed headers `content-type` and
`x-ms-blob-type`, and exposed header `etag`. The API issues a ten-minute,
create-only user-delegation SAS for one randomly named blob; it never gives the
browser read, list, delete, or overwrite permission.

Apply `azure/storage-lifecycle-policy.json` to expire tape blobs after 90 days.
Also schedule `python -m scripts.prune_expired_tapes` daily from the `backend`
directory so expired database metadata and development fallback payloads are
removed. The job is idempotent and treats an already-expired Azure blob as
success.

Schedule `python -m scripts.prune_personal_data` daily as a separate single-instance
job. The initial engineering retention schedule is: practice tapes 90 days;
contact messages 365 days; expired/used password-reset and revoked/expired refresh
records 30 days after becoming terminal; application logs 30 days; PostgreSQL
backups 35 days. Account, consent, calibration, training, and billing records remain
until account deletion unless a separately approved financial/legal hold applies.
These periods are release inputs, not legal conclusions; privacy counsel must approve
the schedule and the public notices. Follow `azure/INCIDENT_RESPONSE.md` for suspected
personal-data incidents.

## Monitoring and alerts

Route Application Insights and platform diagnostics to one Log Analytics
workspace. Start with these alerts, then tune thresholds after collecting two
weeks of production traffic:

- `/health/ready` fails for two consecutive one-minute evaluations: critical;
- HTTP 5xx responses exceed 2% for five minutes, with at least 20 requests: critical;
- server p95 latency exceeds two seconds for ten minutes: warning;
- App Service restarts or unhealthy instances are detected: critical;
- PostgreSQL CPU exceeds 80%, storage exceeds 80%, or active connections exceed 80% of the configured limit for fifteen minutes: warning;
- the six-hour PayPal reconciliation job or daily tape-prune job exits non-zero or misses two expected runs: critical;
- WebSocket connection failures materially exceed the established baseline: warning.

Send critical alerts to an action group monitored by at least two maintainers.
Include the release identifier, request ID, affected route, and UTC time in every
incident record. Never paste tokens, connection strings, or personal data into
alerts or tickets.

## Backup and recovery

Configure PostgreSQL Flexible Server backup retention to 35 days for production.
Choose geo-redundant backup when creating the server if the approved continuity
requirements include a regional outage; that setting cannot be added later in
all configurations. Apply a resource lock to the production database resource
group and restrict delete privileges.

The initial alpha targets are an RPO of 15 minutes and an RTO of four hours.
These are engineering targets, not guarantees, until a timed restore drill
demonstrates them. Run the drill quarterly and after material database or
migration changes, following `azure/RECOVERY_RUNBOOK.md`. A point-in-time restore
creates a separate server: validate migrations, data, authentication, billing,
and core journeys before any controlled connection-string change.

## Frontend Static Web Apps settings

Use `frontend` as the app location, `npm run build` as the build command, and
`frontend/dist` as the output. Build with Node 22.22.0 or newer, matching
`frontend/.nvmrc` and the release workflow. Add the values from
`frontend/.env.production.example` to the build environment. The API must use
`https://` and the WebSocket URL must use `wss://`.

`public/staticwebapp.config.json` supplies SPA routing, camera/microphone
permissions, security headers, and caching for hashed assets and model files.
Its CSP permits the documented PayPal, MediaPipe, model-storage, Azure API, and
`api.xceed.live` origins. Update and browser-test the policy before changing any
production API/model host; do not broadly add `https:` or `*` sources.

## Release gate

Before production:

- follow and record every applicable item in `azure/PRODUCTION_RELEASE_CHECKLIST.md`;
- run `python -m scripts.validate_production_config` against the injected App Service settings;
- build the deployable frontend with `npm run build:production` so missing or placeholder
  production URLs and PayPal identifiers fail before bundling;
- after deployment, run `python -m scripts.smoke_deployment --api-base https://API-DOMAIN
  --frontend-base https://FRONTEND-DOMAIN` from the `backend` directory;

- verify `python -m alembic current` reports the expected head and
  `python -m alembic check` reports no pending model operations;
- configure the PayPal live webhook and verify webhook signatures;
- run Train, Practice, Analysis, registration, subscription, and admin tests;
- test Auto and Eco Studio modes on a low-powered laptop and Android phone;
- verify camera and microphone access on the final HTTPS domain;
- confirm WebSocket reconnection through `wss://`;
- enable database backups and App Service monitoring;
- complete and record a timed database restore drill;
- load-test concurrent WebSocket sessions before increasing worker count.
