# Personal-data incident response

This is an engineering runbook and must be reviewed with Sri Lankan privacy counsel before public launch.

## First response

1. Open a restricted incident record with UTC time, reporter, affected environment, and incident commander.
2. Contain the exposure without destroying evidence: revoke affected credentials, isolate vulnerable deployments, and preserve redacted logs and deployment identifiers.
3. Determine what data, users, systems, and time range are affected. Never copy access tokens, passwords, tape contents, or full personal records into chat or tickets.
4. Engage the privacy lead, security lead, product owner, and legal counsel. Legal counsel decides whether and when the Data Protection Authority or affected people must be notified.
5. Restore service only after the exploit path is closed and access controls, logs, exports, and deletion paths are verified.

## Severity and communication

- Critical: active unauthorized access, exposed credentials, or large/sensitive dataset exposure. Page the incident team immediately.
- High: confirmed personal-data disclosure with no active access. Begin the same assessment immediately.
- Medium: suspected exposure or a failed privacy control with no confirmed disclosure. Preserve evidence and investigate within one business day.

Record facts separately from assumptions. Communications must identify the affected data categories, likely consequences, containment actions, user protections, and a contact channel. Do not promise a statutory deadline without counsel confirming the applicable obligation.

## Closure

Document root cause, affected records, notification decision, recovery validation, and durable corrective actions. Run a tabletop exercise quarterly and after any material identity, billing, storage, or logging change.
