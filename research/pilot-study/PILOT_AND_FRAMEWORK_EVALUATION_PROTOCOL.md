# Expert self-evaluation and framework-evaluation protocol

Protocol version: 1.0 (2026-07-31)

## Aim and research questions

Evaluate whether Combat Cognition can be operated end to end for jab recordings
from the researcher-expert and characterize correctness, latency, usability, and
failure modes within this single case.

- RQ1: How closely do rule-only and hybrid-template outputs agree with blinded
  expert phase/form annotations on the same recordings?
- RQ2: Does the hybrid add useful, grounded feedback without increasing unsafe or
  unsupported feedback?
- RQ3: What latency, tracking availability, and operational failures occur?
- RQ4: Is the prototype usable enough for a larger study?

No hypothesis of population superiority is tested with one participant.

## Design

- Participant: P001, the researcher, developer, and martial-arts expert; flag
  `researcher_participant=yes`.
- Case technique: jab only. This does not establish cross-technique validity.
- Input: consented original video plus synchronized 33-landmark/session tape.
- Comparison: paired replay of every eligible recording under `rule_only` and
  `hybrid_template` using the same code/configuration freeze.
- Feedback remains deterministic/template based. There is no LLM condition until
  a real API/model implementation and logging path are verified.
- Order: collect recordings first; replay conditions in a reproducible randomized
  order recorded in `trials.template.csv`.

### Planned movements

After warm-up/familiarization, record 18 planned repetitions in six clips:

| Clip type | Repetitions | Purpose |
|---|---:|---|
| normal jab | 3 | representative correct performance |
| slow jab | 3 | speed robustness |
| fast jab | 3 | speed/blur robustness |
| deliberate form error | 3 | coaching sensitivity |
| incomplete/aborted jab | 3 | state and rejection behavior |
| unrelated/rest movement | 3 events | false-positive behavior |

The expert predeclares each deliberate error before capture. Participants may stop
at any time; pain, dizziness, or unsafe conditions stop the session. Record rests,
deviations, and invalid repetitions rather than silently replacing them.

## Setup controls

Record device/camera, resolution, nominal and observed FPS, software commit,
browser, ONNX/model hashes, camera angle/distance, lighting, clothing/background,
warm-up, and relevant limitations. Use the same setup for paired replays. Capture
a calibration/setup image without identifying metadata where consent permits.

The application currently saves a landmark/session practice tape at approximately
30 FPS. Original video capture is a separate required procedure unless raw-video
recording is independently verified in the application.

## Ground truth and blinding

1. Copy source clips to annotation filenames that reveal only participant,
   session, and clip ID.
2. Annotate without viewing system predictions, feedback, or condition labels.
3. Mark preparation, extension, peak/impact, retraction, recovery, transition,
   incomplete, and not-applicable intervals using inclusive frame indices.
4. Record repetition validity, intended error, observed form finding, confidence,
   and uncertainty. Do not force a phase when tracking/video evidence is unclear.
5. The researcher-expert completes pass A. Prefer a second independent expert on
   at least 20% of valid repetitions, sampled across all clip
   types. If unavailable, re-annotate a blinded 20% subset after at least seven
   days as pass B.
6. Freeze annotations before joining them to system output.

Agreement reporting: phase frame agreement and boundary absolute error; for a
second expert report Cohen's kappa where defined plus boundary error. For repeat
self-rating, label it intra-rater agreement, not independent validation.

## Outcomes

Primary feasibility outcomes:

- proportion of planned clips with complete video, tape, logs, and paired output;
- phase frame accuracy and macro F1 against expert labels;
- boundary mean/median absolute error in frames and milliseconds;
- feedback correctness, relevance, actionability, clarity, groundedness, and
  safety (1–5 blinded expert ratings);
- unsafe/unsupported feedback count and rate;
- end-to-end latency median and p95, with measurement points defined;
- tracking availability and prediction/forecast availability;
- failure count and severity by category;
- participant usability item distributions and per-participant summaries.

Secondary descriptive outcomes include repetition count error, form-finding
sensitivity/false positives, condition differences per paired clip, and comments.
Do not use the word “improvement” to imply training benefit.

## Latency definition

Prefer monotonic timestamps from: frame acquisition (`t0`), pose availability
(`t1`), temporal/rule decision (`t2`), awareness/feedback decision (`t3`), and UI
render (`t4`). Report stage latencies and `t4-t0`. If only one application latency
exists, state exactly what it measures. Do not mix replay processing time with
live response latency.

## Feedback review

Blind reviewers to condition using randomized output IDs. Rate each distinct
feedback event with the template. A safety score below 4, unsupported claim, or
medical/guaranteed-performance wording triggers review. The researcher may review,
but disclose self-review and record reviewer identity/role. Prefer independent
review of the same 20% subset.

## Failure taxonomy

Use: `capture`, `tracking_loss`, `landmark_error`, `phase_error`,
`boundary_error`, `rep_count_error`, `forecast_unavailable`, `false_warning`,
`missed_warning`, `feedback_unsafe`, `feedback_unsupported`, `latency`, `storage`,
`condition_contamination`, or `other`. Severity is 1 cosmetic, 2 recoverable,
3 invalidates a trial, 4 safety/privacy critical.

## Analysis and claim rules

- Preserve clip- and repetition-level results; aggregate only descriptively.
- Report counts, denominators, median/IQR, mean/SD where useful, and paired raw
  differences. Avoid significance tests and population confidence claims at n=1.
- Treat usability reflections as researcher evidence, not independent participant
  usability validation.
- Exclude only using predeclared reasons: consent withdrawal, corrupt source,
  protocol safety stop, missing paired condition, or unusable ground truth.
  Report every exclusion and keep technical failures in feasibility denominators.
- Do not tune thresholds/models using pilot outcomes. Any post-hoc change creates
  a new exploratory run and the original result remains preserved.
- Generated phase-model evidence remains a pipeline bootstrap result. Pilot data
  may later become a grouped real dataset, but participant/session groups must be
  assigned before window creation, with a held-out test set untouched.

## Bias and ethics statement for later use

The framework is expert-informed design-science with reflexive practitioner
inquiry. The researcher's 25+ years of experience informs design and annotation,
but participation, system authorship, and self-review create expectancy and
confirmation risks. Blinding, frozen annotations, identical paired recordings,
an audit trail, and preferably a second expert mitigate but do not eliminate them.

## Stop/go criteria

Start data collection only after consent/ethics requirements, raw-video storage,
clock/latency logging, condition switching, same-recording replay, and export of
machine-readable outputs are verified in a dry run. Proceed to interpretation
only if artifact completeness and exclusions are auditable. Otherwise report the
pilot as incomplete and repair the procedure before collecting more participants.
