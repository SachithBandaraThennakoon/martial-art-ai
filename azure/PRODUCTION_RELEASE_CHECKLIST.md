# Production release checklist

Use this checklist for every production release. Record the release SHA, operator,
UTC start/end times, migration revision, and links to the Azure deployment and
monitoring views. Never paste secret values into the record.

## Approval gate

- [ ] Product owner approves the release scope and rollback decision-maker.
- [ ] Privacy counsel approves the public privacy notice, terms, and retention periods.
- [ ] Billing owner confirms live PayPal client, three unique live plan IDs, and webhook ID.
- [ ] Security owner confirms administrator MFA/passkey policy and production access list.
- [ ] Operations owner confirms alerts, backups, and the latest timed restore drill.

## Before deployment

1. Run all CI release gates from a clean commit.
2. From `backend`, run `python -m scripts.validate_production_config` with the exact
   App Service settings injected by the deployment system.
3. From `frontend`, run `npm run build:production` with the exact Static Web Apps
   build variables. Do not deploy a bundle produced by the fallback localhost values.
4. Back up/confirm PostgreSQL point-in-time recovery, then run one single-instance
   `python -m alembic upgrade head` release job.
5. Run `python -m scripts.sync_technique_catalog` once and record the output.
6. Confirm Azure Blob managed-identity roles and apply `storage-lifecycle-policy.json`.

## After deployment

Run the read-only deployment smoke suite:

```text
python -m scripts.smoke_deployment --api-base https://API-DOMAIN --frontend-base https://FRONTEND-DOMAIN
```

Then verify:

- [ ] `/health/live` and `/health/ready` are green from outside Azure.
- [ ] Registration, login, password reset email, logout, and session rotation.
- [ ] Free-plan denial and paid-plan access using dedicated sandbox/release accounts.
- [ ] PayPal live checkout and a signed webhook event using a minimal controlled charge.
- [ ] Train, Practice, tape upload/read, Analysis, and account JSON export.
- [ ] Account deletion cancels the test subscription and removes its private tape.
- [ ] WebSocket reconnects after access-token rotation on the final `wss://` domain.
- [ ] Camera/microphone permission and Auto/Eco modes on the target Android phone.
- [ ] Application Insights receives a request carrying its `X-Request-ID` without personal data.
- [ ] Scheduled reconciliation, tape-prune, and personal-data-prune jobs are enabled and alerted.

## Rollback

Stop rollout if readiness fails, migrations drift, authentication/session rotation fails,
billing ownership is uncertain, private storage is public, or telemetry contains secrets or
personal data. Follow `RECOVERY_RUNBOOK.md`; prefer rolling application code back while
keeping forward-compatible schema. Never run an Alembic downgrade against production data
without a reviewed data-impact plan and a verified backup.
