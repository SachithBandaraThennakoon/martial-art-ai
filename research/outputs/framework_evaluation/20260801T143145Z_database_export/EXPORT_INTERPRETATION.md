# Combat Cognition database export interpretation

Export generated: 2026-08-01 14:31:45 UTC  
Participant: P001 (researcher-expert)  
Technique: jab  
Design: single-participant expert feasibility case

## Integrity and privacy

- Archived filename: `combat-cognition-jab-research-export.json`
- Bytes: 31,968,016
- File SHA-256: `1b4ba961a6f275c12e973f88711a6277c0124acb651fe2b73b64cc5455b0110f`
- Stored canonical content SHA-256:
  `9634cd2e9c313bc43a75907dde7ce7c3fa7631743904f36022d4d42d30c89df1`
- Recalculated canonical hash matched the stored hash.
- No email, password, authentication token, username, or database user ID key was
  found in the exported document.
- Raw video and account identity are explicitly excluded.
- The landmark tapes remain potentially identifying movement data and are kept
  out of Git by the local `.gitignore`.

## Inventory

| Evidence | Count |
|---|---:|
| Practice sessions | 42 |
| Completed practice sessions | 18 |
| Cancelled practice sessions | 17 |
| Active practice sessions | 7 |
| Recorded practice repetitions | 58 |
| Practice sessions with landmark tapes | 22 |
| Landmark frames | 7,277 |
| Captured landmark-tape duration | 241,867 ms (about 4.03 min) |
| Training sessions | 185 |
| Training sessions marked complete | 2 |
| Training step attempts | 140 |
| Feedback events | 3,623 |
| Sessions with tracking-quality analytics | 15 |
| Sessions with response-time analytics | 0 |

The source date range is 2026-07-01 through 2026-08-01. These records include
development and exploratory use, not a single controlled study run.

## Machine-evidence observations

- All 7,277 decoded tape frames contain structured motion/session fields.
- 3,139 frames contain saved rule-engine analysis.
- 1,152 frames contain forecast-awareness data.
- Tape metadata preserves canonical session summaries, rule-engine analysis,
  completion state, steps, capture window, and post-session classification.
- Among the 15 sessions with tracking analytics, the median recorded tracking
  quality is 81.3%, with a range of 70.1%–96.4%.
- Completed-session system scores have a median of 94.0%, but range from 0% to
  100%. These are application scores and must not be called ground-truth accuracy.

The latest practice session (`practice-42`, 2026-08-01 12:30 local time) records
3 completed repetitions, 98.14% application score, 250 frames, and 96.0% tracking
quality. It aligns temporally with the supplied August 1 screenshot evidence, but
this relationship should be confirmed by the researcher before treating it as the
same demonstrated session.

## What this evidence supports

The export supports reproducible claims that the application stores and exports
jab practice/training histories, repetitions, coaching events, landmark tapes,
rule-derived analyses, forecast-awareness fields, and multi-session analytics.
It also supports failure/availability analysis because incomplete, cancelled,
active, and completed sessions were retained.

## What it does not yet support

- Independent phase or form accuracy: no blinded expert frame annotations are
  joined to these predictions.
- A rule-only versus hybrid controlled comparison: records do not include a
  verified experimental-condition label.
- End-to-end latency: response-time analytics are unavailable for every exported
  practice session.
- Participant usability: P001's structured reflective ratings are not present.
- Generalization: this is one researcher-expert and one technique.
- LLM operation: feedback events are current deterministic/template output.

## Recommended controlled subset

Do not calculate a headline system accuracy over all historical records. Use a
small, declared August 1 subset after P001 confirms which sessions correspond to
the supplied screenshots. Retain the remaining sessions as development-history
and failure-mode evidence. For stronger evaluation, record one final controlled
jab set with an experiment ID, condition label, latency timestamps, and expert
annotations frozen before inspecting predictions.
