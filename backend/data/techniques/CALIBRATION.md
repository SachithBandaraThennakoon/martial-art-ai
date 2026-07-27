# Temporal technique calibration

Rule packages are code-complete only after automated transition tests pass. They
are student-ready only after recorded-session calibration passes the gates below.

## Recording set

For each technique, collect front and front-diagonal recordings from at least
five people with different heights, limb proportions, clothing, speed, and
camera distance. Keep the raw landmarks and human-reviewed labels for:

- session start, pause, tracking loss, recovery, and session end;
- repetition start, completion, and abort boundaries;
- every technique step and ENTRY, HOLD, and EXIT phase boundary;
- confirmed form errors and deliberately clean repetitions;
- unknown movements and incomplete repetitions.

Do not tune thresholds against the final evaluation recordings. Split recordings
by person so one person's frames cannot appear in both calibration and evaluation.

## Readiness gates

A package may ship in Practice mode when all of these are true:

- repetition precision and recall are each at least 95%;
- completed-versus-incomplete classification is at least 95%;
- no single noisy frame changes a state in the regression suite;
- median step-boundary error is at most 150 ms;
- brief tracking-loss repair never invents a repetition;
- every reported form error persists for its configured confirmation window.

A package may ship in Train mode when the Practice gates pass and:

- live session state agrees with reviewed labels at least 97% of the time;
- pause and resume preserve the current repetition without double counting;
- the 95th-percentile spoken-cue delay is within the configured cue budget;
- false corrective cues are below 3% of clean repetitions.

These are initial engineering gates, not clinical or competition judging claims.
Revisit them after the first representative production dataset.

## Agile promotion flow

1. Add or update the technique package without changing the shared engine.
2. Add synthetic tests for valid, noisy, timed-out, incomplete, and
   tracking-loss sequences.
3. Run the package against the calibration recordings and adjust only its JSON
   thresholds, durations, hysteresis, and confirmation policy.
4. Freeze the thresholds and run the person-held-out evaluation set.
5. Enable Practice first. Review corrected tapes and form-error frequency.
6. Enable Train after the live-session and cue-timing gates pass.
7. Version the package whenever a shipped threshold or transition changes.

## Evaluation output

Store one machine-readable report per package version containing:

- dataset version and person-level split;
- repetition precision, recall, and boundary error;
- per-state and per-phase confusion matrices;
- form-error precision and recall;
- tracking-loss repair counts and rejected transitions;
- cue latency percentiles;
- pass or fail for every readiness gate.

Never silently overwrite a report for a released package version.
