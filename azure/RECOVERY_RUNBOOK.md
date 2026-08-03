# Production recovery runbook

Use this runbook for the quarterly restore exercise and for an actual PostgreSQL
incident. Record every timestamp in UTC. The incident lead must approve any
production connection-string change.

## Targets and ownership

- Initial engineering target: RPO 15 minutes, RTO four hours.
- Incident lead: owns decisions and communication.
- Recovery operator: performs Azure and database steps.
- Validator: independently verifies security, data, billing, and user journeys.

Keep current names and contacts in the private operations system, not in Git.

## Before an incident

1. Confirm automated backup retention is 35 days and backup status is healthy.
2. Confirm the production resource group has an appropriate delete lock.
3. Export the expected Alembic head with each release record.
4. Keep deployment artifacts and the prior known-good release available.
5. Run and time this procedure at least quarterly. Record achieved RPO and RTO.

## Restore procedure

1. Declare the incident, assign roles, and freeze schema deployments and jobs
   that mutate billing or retention data.
2. Determine the last known-good UTC restore point from monitoring and audit
   evidence. Record why it was selected.
3. Use Azure point-in-time restore to create a **new** PostgreSQL Flexible Server.
   Do not overwrite or delete the affected server.
4. Restrict the restored server's network access to the recovery operators and
   a non-production validation instance.
5. Point a temporary validation deployment at the restored server. Do not change
   the production secret yet.
6. From the exact application release under recovery, run:

   ```text
   python -m alembic current
   python -m alembic check
   ```

   The current revision must equal the release's recorded expected head. Do not
   run an upgrade until the incident lead reviews its data impact.
7. Compare critical counts and recent timestamps with monitoring or approved
   exports: users, refresh sessions, subscription records, training sessions,
   and tape metadata. Reconcile a sample of active PayPal subscriptions without
   changing entitlement state.
8. Test registration/login, token refresh, dashboard, Train, Practice, Analysis,
   subscription access, and admin authorization. Confirm `/health/ready` is 200
   and telemetry is arriving without secrets.
9. Record the restore point, observed data-loss window, validation evidence, and
   elapsed time. The validator signs off independently.
10. If approved, update the production database secret to the restored server,
    restart one backend instance, and run a smoke test. Then roll the remaining
    instances. Monitor errors, latency, billing reconciliation, and WebSockets.

## Abort and rollback

If validation fails, keep production isolated or on the original server as the
incident requires. Revert the connection-string secret to the last approved
server and redeploy the prior known-good application release. Do not delete
either database server until the incident review and retention period are
complete.

## After recovery

Re-enable paused jobs one at a time, run billing reconciliation, verify tape
retention, and monitor closely for 24 hours. Complete an incident review with
the actual RPO/RTO, root cause, user impact, recovery evidence, and assigned
follow-up actions. Rotate any credential that may have been exposed.
