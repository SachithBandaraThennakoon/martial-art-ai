# Combat Cognition production-readiness review

Date: 2026-08-03  
Scope: deployable frontend/backend, production configuration, and the latest
research/thesis handoff. Research artifacts were treated as evidence and claim
controls, not as runtime requirements.

## Executive decision

The application has a substantial, testable prototype core, but it is **not yet
ready for a public paid production launch**. A private, access-controlled alpha
is reasonable after the Phase 0 blockers below are closed.

The strongest current engineering evidence is:

- 144/144 frontend behavioral assertions pass;
- 67/67 backend unit, API, and migration tests pass;
- frontend ESLint passes;
- backend Python compilation passes; and
- the Vite production bundle builds successfully.

These checks support software correctness for the tested paths. They do not
establish security, scale, payment correctness, model generalization, or coaching
safety.

## Implementation update — 2026-08-03

Milestone **P0G: production deployment rehearsal and release verification** is implemented:

- backend startup now fails fast on missing, placeholder, insecure, inconsistent, or
  sandbox production settings, including the previously undocumented `FRONTEND_URL`;
- frontend production builds validate HTTPS/WSS API endpoints and distinct live PayPal
  identifiers before Vite can bundle fallback localhost values;
- CI executes both production configuration contracts in addition to existing release gates;
- a read-only deployed-environment smoke command verifies liveness, readiness, request IDs,
  legal-document versions, authentication boundaries, CORS credentials, hosting security
  headers, SPA routes, and WebSocket authentication;
- an isolated local deployment rehearsal passed the smoke suite against PostgreSQL migration
  head `e5b7f4a2c631`;
- browser verification covered registration consent gating, privacy/terms content, protected
  account-route redirection, console errors, and a 390×844 mobile viewport, and corrected the
  discovered consent-field ordering issue; and
- `azure/PRODUCTION_RELEASE_CHECKLIST.md` now defines approvals, pre-deploy steps,
  post-deploy journeys, stop conditions, and rollback discipline.

P0 engineering implementation is complete. A public launch remains externally gated on
final legal approval, live Azure/PayPal configuration, administrator MFA/passkeys, a timed
restore drill, target-device camera/microphone testing, and production load testing.

Milestone **P0A.1: centralized account and entitlement boundary** is implemented:

- one backend authentication module now resolves current users for HTTP and
  WebSocket requests;
- newly issued access tokens use the immutable user ID as their subject, while
  legacy email-subject tokens remain temporarily compatible;
- tokens now contain issued-at, access-token type, and unique token-ID claims;
- authenticated `GET /me` returns the server-calculated effective plan, role,
  subscription state, and relevant expiry dates;
- expired/inactive paid access falls back to Free, while administrators receive
  the administrator tier independently of browser state;
- practice-session creation rejects unknown techniques and enforces the selected
  technique's required plan;
- coaching WebSockets reject query-string authentication, fail closed when the
  database/account is unavailable, and require an authorized known technique
  before accepting coaching events;
- admin API dependencies, dashboard authentication, and subscription activation
  now use the centralized current-user dependency;
- the frontend hydrates role/plan/name from `/me` and no longer trusts persisted
  `localStorage` role or plan values; and
- nine new backend identity/entitlement tests pass alongside the existing suite.

Milestone **P0A.2: short-lived, revocable browser sessions** is also implemented:

- access tokens now expire after 15 minutes and exist only in frontend memory;
- a one-time compatibility path removes legacy access tokens from browser storage;
- login issues a 30-day opaque refresh token in an `HttpOnly` cookie and stores
  only its SHA-256 hash in the database;
- every refresh rotates the token, and reuse of a replaced token revokes all
  active descendants in that token family;
- logout revokes the current token family, and password reset revokes every
  refresh session belonging to the account;
- browser API requests refresh and retry once after an authentication failure,
  with proactive refresh and Web Locks coordination between modern browser tabs;
- login, refresh, and logout enforce the configured browser-origin allowlist;
- local development uses a consistent `localhost` host so the same-site refresh
  cookie works without weakening cookie policy; and
- the refresh-session table is included in the reviewed Alembic baseline.

Milestone **P0A.3: shared abuse controls** is implemented:

- state-changing HTTP requests use a shared PostgreSQL fixed-window limiter, so
  counters apply across workers, restarts, and horizontally scaled instances;
- login, registration, refresh, password recovery, contact, and subscription
  activation have tighter IP, account, token, or user-level policies;
- rate-limit subjects are HMAC-SHA256 hashes rather than stored IP addresses,
  email addresses, reset tokens, or refresh tokens;
- limited responses include `Retry-After` and a machine-readable
  `X-RateLimit-Code: rate_limited` header;
- a failure of the shared protection store fails closed with HTTP 503;
- WebSocket connection attempts are limited by shared IP and user counters;
- each WebSocket also enforces message size, message frequency, and a 15-minute
  maximum lifetime requiring reconnection with a current access token; and
- App Service proxy-trust configuration and Alembic deployment requirements are
  documented.

Verification after P0A.3: 44/44 backend tests, 144/144 frontend assertions,
frontend lint, backend compilation/import, and the production build pass.

The P0A identity and access boundary is functionally complete for an alpha, but
email verification and administrator MFA remain required before a public paid
launch. Database-backed fixed-window limiting is an appropriate first shared
control; load-test its database write amplification and edge-of-window burst
behavior, and move hot counters to managed Redis if traffic makes PostgreSQL
contention material. Older browsers without Web Locks receive same-tab refresh
de-duplication but not cross-tab coordination. Also, because technique packages
and local scoring code are compiled into the browser bundle, server enforcement
protects server services and persistence but cannot make downloaded client code
secret. Conditional package delivery or a product decision to monetize services
rather than package secrecy remains required.

Milestone **P0B.1: reviewed database migrations** is implemented:

- Alembic 1.18.5 is pinned and configured against the complete SQLAlchemy
  metadata;
- baseline revision `883102153f8d` creates all 18 application tables, indexes,
  foreign keys, and uniqueness constraints for a fresh database;
- application startup no longer runs `create_all` or ad-hoc `ALTER TABLE`
  operations, and production fails closed when the database is not at head;
- technique-catalog upserts moved from API import into an explicit idempotent
  release command;
- an optional single-instance startup migration switch exists, while production
  guidance requires a single pre-deployment migration job to avoid races;
- the adoption utility validates an existing schema before allowing an explicit
  stamp and refuses incomplete databases;
- the local PostgreSQL database was validated, adopted, and confirmed with
  `alembic current` and `alembic check`;
- unused legacy taxonomy tables and columns are deliberately retained so schema
  adoption cannot destroy historical data; and
- migration tests cover fresh upgrade, metadata drift detection, downgrade, safe
  legacy adoption, and refusal to stamp an incomplete schema.

Verification after P0B.1: 47/47 backend tests, 144/144 frontend assertions,
frontend lint, backend compilation/import, live PostgreSQL revision/drift checks,
and the production build pass.

Milestone **P0C.1: bounded private practice-tape ingestion** is implemented:

- production issues a ten-minute, write-only user-delegation SAS for one private
  Azure blob using the App Service managed identity;
- the browser declares frame count, byte length, duration, SHA-256, schema,
  algorithm/config versions, and an idempotency key before upload;
- finalization downloads at most the configured byte limit and verifies content
  type, length, checksum, strict frame fields, landmark shapes/ranges, monotonic
  timestamps, metadata allow-list, nesting, duration, and frame count;
- local development retains a streamed database fallback capped before JSON
  parsing rather than accepting the previous 60 MB parsed Pydantic body;
- tape records now preserve storage provider, upload state, checksum, device
  estimate provenance, algorithm/config versions, verification time, and expiry;
- per-user tape operations are rate-limited and session writes are idempotent;
- stored score displays and research exports explicitly label measurements as
  device-generated coaching estimates rather than independent ground truth; and
- a 90-day Azure lifecycle policy plus a daily metadata/fallback pruning command
  is included for deployment.

This closes the direct database-blob and unbounded pre-parse portions of P0.5
and P0.6. Canonical server-side reprocessing, asynchronous export/analytics jobs,
account deletion, and aggregate per-user storage quotas remain later milestones.

Milestone **P0D.1: operational health, telemetry, and recovery controls** is implemented:

- `/health/live` reports process liveness without contacting dependencies, while
  `/health/ready` performs a live database and Alembic-revision check and returns
  HTTP 503 when the instance should leave rotation;
- the legacy `/health` route remains as a readiness-compatible alias;
- each HTTP response carries a validated or generated `X-Request-ID`, and
  production request logs are structured JSON using route templates rather than
  user-controlled URL values;
- log filtering redacts bearer/JWT tokens, signed query values, and email
  addresses, while request bodies and raw exception text are not logged;
- Azure Monitor OpenTelemetry is pinned and configured for request metrics,
  duration histograms, distributed traces, platform collection, and live metrics;
- the backend image runs with an unprivileged UID and includes a liveness
  `HEALTHCHECK`, while `.dockerignore` excludes local secrets, virtual
  environments, tests, caches, and development databases from the image context;
- the Azure handoff now defines initial readiness, 5xx, latency, restart,
  PostgreSQL-capacity, WebSocket, reconciliation, and retention-job alerts; and
- the recovery runbook defines a separate-server point-in-time restore, migration
  and journey validation, controlled cutover, rollback, quarterly drills, and
  provisional alpha targets of 15-minute RPO and four-hour RTO.

Verification after P0D.1: 67/67 backend tests pass, including new liveness,
readiness, correlation-ID, and redaction tests. Python compilation and Alembic
model-drift checks also pass. Azure alert creation and a timed PostgreSQL restore
drill remain deployment-environment release gates.

Milestone **P0E.1: dependency, repository, and browser hardening** is implemented:

- React Router is upgraded from affected 7.x releases to patched 8.3.0, all DOM
  imports are migrated to `react-router`, and React 19.2.7 plus Node 22.22.0 are
  pinned as the supported baseline;
- the JWT implementation moves from `python-jose` and its vulnerable `ecdsa`
  dependency to PyJWT while preserving the existing HS256 token contract;
- FastAPI, Starlette, cryptography, multipart parsing, Click, IDNA, and dotenv
  are upgraded to versions clearing the current Python advisory scan;
- Azure Static Web Apps now sends a restrictive application-specific CSP, HSTS,
  clickjacking, content-type, referrer, permissions, opener, and resource policy
  headers while retaining required PayPal, MediaPipe, WebAssembly, API, and
  WebSocket behavior;
- the tracked local frontend `.env` and eight compiled training `.pyc` files are
  removed from the Git index without deleting local developer copies, and
  example PayPal identifiers are replaced with placeholders;
- a repository-hygiene checker rejects tracked local environment files, Python
  caches, dependency directories, private keys, and common high-confidence cloud
  token formats; and
- GitHub Actions now gates frontend tests/lint/build/audit, backend PostgreSQL
  migrations/tests/compilation/audit, and repository hygiene, with weekly
  Dependabot updates for npm, pip, and workflow actions.

Verification after P0E.1: 67/67 backend tests pass; all frontend test files,
frontend lint, and the production build pass; npm and both Python requirement
audits report no known vulnerabilities; Alembic drift, JSON configuration,
repository hygiene, and diff checks pass. The local Node runtime is 22.19.0, so
the workflow and deployment are pinned to the supported 22.22.0 baseline.

## Phase 0 — release blockers

### P0.1 Enforce plans and trials on the server

`userPlan` and `userRole` are cached in browser `localStorage`, and feature access
is mainly decided by frontend code. The authenticated practice and training APIs
and coaching WebSocket do not consistently enforce plan, subscription status, or
trial expiry. A user can modify browser state, call APIs directly, or retain
access after a subscription state changes.

Required change:

- create one backend `current_user` dependency and one entitlement service;
- evaluate role, plan, trial expiry, subscription status, and account status on
  every protected HTTP and WebSocket operation;
- return the current server-owned profile/entitlements from a `/me` endpoint;
- treat frontend plan checks only as user-interface convenience; and
- add negative authorization tests for every paid/admin capability.

### P0.2 Complete the PayPal lifecycle

The backend verifies an active subscription during `/subscription/activate`, but
there is no implemented webhook endpoint or signature verification. The configured
`PAYPAL_WEBHOOK_ID` is unused. Cancellation, suspension, expiration, refund, or
payment failure can therefore leave local access active indefinitely.

Required change:

- add an idempotent PayPal webhook with signature verification;
- store provider event IDs and reject replayed events;
- reconcile activation, cancellation, suspension, expiry, and payment failure;
- add a scheduled reconciliation job for missed webhooks;
- use database uniqueness for provider subscription IDs; and
- test sandbox events before enabling live billing.

### P0.3 Establish production authentication and session security

Access tokens currently live in `localStorage` and default to seven days. There
is no refresh-token rotation, server-side revocation, session inventory, login
rate limiting, registration rate limiting, email verification, or admin MFA.
Password-reset throttling is process-local and will not be consistent across two
workers or multiple instances.

Required change:

- use short-lived access tokens and rotated, revocable refresh sessions;
- prefer Secure, HttpOnly, SameSite cookies if the final frontend/API topology
  supports them, with CSRF protection where required;
- move all abuse counters to a shared store or edge gateway;
- rate-limit login, registration, reset, contact, export, upload, and WebSocket
  connection attempts;
- add email verification and admin MFA/passkeys;
- support account disablement and forced session revocation; and
- remove legacy query-string WebSocket token support.

### P0.4 Replace automatic schema mutation with migrations

The application calls `create_all`, performs column repair, and synchronizes the
technique catalog during module import/startup. This is unsafe with multiple
workers, gives weak rollback control, and makes deployments nondeterministic.

Required change:

- introduce Alembic with a reviewed baseline and forward migrations;
- run migrations once as a release step, not from every web worker;
- move catalog synchronization to an explicit, idempotent deployment command;
- add foreign-key deletion policies, non-null constraints, check constraints,
  and uniqueness where the domain requires them; and
- rehearse backup restoration and migration rollback in staging.

### P0.5 Separate measured evidence from client assertions

Clients can submit repetition accuracy, durations, labels, and a corrected final
summary; the backend bounds the values but accepts them as the stored result.
This is acceptable for prototype telemetry, but it is not trustworthy for paid
progress tracking, certification, competition, safety, or cross-user comparison.

Required change:

- label present scores as device-generated coaching estimates;
- preserve raw event provenance and algorithm/model/config versions;
- calculate canonical aggregates in a trusted backend job where feasible;
- make post-session correction auditable rather than silently authoritative;
- add idempotency keys and uniqueness for repetitions/session completion; and
- never market these values as clinical, injury-prevention, certification, or
  independently validated performance scores.

### P0.6 Bound resource use before parsing

Practice tapes are checked after FastAPI/Pydantic has parsed the request. A
single request may contain up to 9,000 arbitrary dictionaries and 60 MB of JSON,
then consume CPU during compression. WebSocket message size/rate and research
exports are also not application-bounded. This creates denial-of-service and
cost risk.

Required change:

- enforce request and WebSocket message limits at the gateway/server before
  application parsing;
- define a strict frame schema, metadata allow-list, numeric ranges, and nesting
  limits;
- upload large tapes directly to private object storage with short-lived signed
  URLs, checksum verification, quotas, and lifecycle deletion;
- move compression/analytics/export work to bounded background jobs; and
- load-test realistic concurrent camera sessions on the target Azure tier.

### P0.7 Resolve the known dependency advisory

Resolved in P0E.1 by migrating to React Router 8.3.0, updating its runtime
baseline, rerunning frontend regression/build checks, and adding dependency
auditing and update automation. Staging browser route/auth and PayPal checkout
tests remain release gates because unit/build checks cannot validate hosted CSP
and popup behavior.

## Phase 1 — required before public alpha

### Privacy, consent, and user rights

Landmark tapes, body calibration, training history, voice/chat inputs, and form
feedback are sensitive behavioral data even when raw video is not stored. Add:

- versioned privacy notice, terms, consent records, and age policy;
- clear camera/microphone just-in-time notices;
- complete user data export and account deletion workflows;
- retention schedules for tapes, messages, reset tokens, logs, and backups;
- encryption/key-management documentation and least-privilege database access;
- an incident-response and breach-notification procedure; and
- a jurisdiction-specific legal/privacy review before accepting public users.

### Health, monitoring, and recovery

The application-side health, correlation logging, Azure telemetry integration,
alert specification, and recovery procedure are now implemented. Before public
alpha, provision and test the alerts, verify production telemetry redaction, add
explicit WebSocket connection/error metrics, and complete a timed PostgreSQL
point-in-time restore drill to validate the provisional RPO/RTO.

### API and data integrity

- Centralize authentication instead of decoding JWTs independently in several
  modules.
- Validate JWT issuer, audience, token type, issued-at/not-before, and a stable
  immutable user ID rather than using email as the subject.
- Add optimistic locking/idempotency to session and subscription writes.
- Replace repeated per-event commits in live coaching with bounded batched writes.
- Add pagination and export job limits.
- Add explicit API versioning and a stable error contract.

### Web and container hardening

- Add a restrictive Content Security Policy compatible with MediaPipe, ONNX, and
  PayPal; also add HSTS, frame restrictions, and a deliberate cross-origin policy.
- Run the backend container as a non-root user, add a container health check, pin
  a supported Python base image/digest, and scan the built image.
- Keep secrets in Key Vault/managed identity and ensure logs never contain tokens,
  reset URLs, personal inputs, or landmark payloads.
- Validate allowed WebSocket origins and enforce idle/session timeouts.

### Repository and build hygiene

The repository currently tracks `frontend/.env` and compiled Python `.pyc`
artifacts even though ignore rules now cover those patterns. Remove them from Git
history/index as appropriate, verify whether any historical value needs rotation,
and retain only sanitized example environment files. The PayPal browser client ID
is public by design, but environment files should still not be the source of truth
for deploy configuration.

## Phase 2 — product-quality gate

### Model and coaching safety

The thesis evidence correctly limits the evaluated system to a P001, jab-only,
laptop-camera expert feasibility/self-evaluation, and identifies generated data
for the phase model. Production must preserve those boundaries:

- show confidence/coverage and an explicit "unable to assess" state;
- feature-flag learned models until real grouped participant/session validation;
- measure drift by device, lighting, camera angle, body visibility, clothing,
  movement speed, handedness, and demographic factors;
- add a prominent physical-space/warm-up/stop-if-pain safety flow;
- avoid medical, injury-prevention, self-defence effectiveness, and universal
  accuracy claims; and
- create a reviewed technique-release process before expanding beyond the
  validated evaluation scope.

### Performance and UX

The build succeeds, but ONNX Runtime emits large WebAssembly assets (about 13.5
MB and 24.3 MB uncompressed variants), and the main application/vision bundles
are substantial. Measure cold start, camera-ready time, memory, battery, thermal
load, dropped frames, and recovery on low-end Android and laptops. Keep research
models/admin diagnostics lazy-loaded, use versioned model caching, and define an
offline/poor-network behavior.

### Test and release system

Create CI gates for:

- frontend unit tests, lint, and production build;
- backend unit/API integration tests against PostgreSQL;
- migrations from the last production version;
- authorization matrix and tenant-isolation tests;
- PayPal webhook/reconciliation tests;
- dependency, secret, SAST, container, and IaC scans;
- Playwright flows for auth, camera permission, Train, Practice, Analysis,
  billing, admin denial, and account deletion; and
- staging smoke, rollback, performance, and backup-restore tests.

## Recommended implementation sequence

1. Freeze a `production-alpha` scope: one technique, explicit feasibility label,
   no certification/medical claims, invite-only users.
2. Build centralized identity/session/entitlement enforcement and tests.
3. Add Alembic migrations and database constraints.
4. Finish PayPal webhooks/reconciliation in sandbox.
5. Move tapes to bounded private object storage and introduce retention/deletion.
6. Add health/readiness, structured telemetry, alerts, backups, and rate limits.
7. Resolve dependency/repository hygiene and harden CSP/container configuration.
8. Run staging E2E, security, concurrency, mobile performance, and recovery gates.
9. Launch a small monitored alpha with feature flags and a rollback plan.

## Suggested first production milestone

**Milestone P0A: trusted identity and access boundary**

Deliverables:

- shared backend authentication/current-user module;
- `/me` with server-owned role, plan, subscription, and trial status;
- HTTP and WebSocket entitlement enforcement;
- short-lived access/refresh session design with revocation;
- distributed rate-limit interface;
- authorization matrix tests; and
- no behavior or claim expansion beyond the current jab feasibility scope.

This milestone should precede cloud deployment and live billing because every
later production control depends on a trustworthy user and entitlement boundary.
