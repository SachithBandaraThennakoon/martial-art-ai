# Curated framework-evaluation subset

The researcher confirmed that the latest practice session, `practice-42`, is the
valid session associated with the supplied evidence. It is therefore the only
practice session included in the primary case-study subset.

## Selection decision

- Included: `practice-42`
- Excluded from headline evaluation: 41 earlier practice sessions and all 185
  training sessions in the export
- Reason: earlier records are mixed development, exploratory, incomplete, and
  potentially outlier sessions rather than a predeclared controlled dataset
- Timing: selection was confirmed before final framework analysis
- Preservation: the complete original export remains unchanged for audit and
  failure-history purposes

This is a defensible scope restriction, not deletion of inconvenient results. The
selection rule is recency plus explicit researcher confirmation—not the magnitude
of the session score.

## Confirmed session

- Date/time: 2026-08-01 12:30:50–12:31:01 (+05:30)
- Status: completed
- Target/canonical completed repetitions: 3/3
- Canonical clean repetitions: 3
- Application average score: 98.14%
- Application best score: 100%
- Application consistency score: 97.63%
- Landmark tape: 250 frames at nominal 30 FPS over 8,300 ms
- Tracking quality: 96.0%
- Post-session correction: duration-aware decoder changed 22 frames
- Forecast-awareness and rule-analysis fields are stored in the tape

These are system-produced descriptive values, not independent accuracy.

## Retained integration inconsistency

The export contains contradictory representations that must not be hidden:

- canonical/post-session summary: 3 completed repetitions;
- rule-engine analysis summary: 0 total/completed repetitions;
- rule-engine segment list: one GUARD segment and no repetitions;
- database repetition table: one row, despite the canonical count of three;
- the stored repetition duration is 23,487 ms, longer than the approximately
  10.67-second database session and 8.3-second tape.

This indicates that canonical post-session clustering/repair, live rule-engine
state, and database repetition persistence were not synchronized in this run.
The screenshot timeline visually supports three post-session clusters, but an
expert annotation is still required before interpreting them as correct jabs.

P001 subsequently confirmed that the three post-session clusters are good and
correct, and that screenshots 6–14 are selected moments from this analysis. See
`P001_EXPERT_CLUSTER_VALIDATION.md`. This supplies expert self-validation, not an
independent annotation.

For the case study, report this as a data-layer consistency/failure-mode finding.
Do not use the 98.14% value as ground-truth system accuracy.
