# Field runbook

## Before participant arrival

- Record protocol/config version, Git commit, browser/OS/hardware, model hashes.
- Verify restricted video/consent storage and repository exclusion.
- Run one non-study dry run; prove rule-only and hybrid-template produce labeled,
  independently reproducible output from the exact same tape.
- Verify all latency timestamps and export files; synchronize clocks if needed.
- Prepare anonymized ID and randomized clip/order sheet.

## With each participant

- Complete approved information/consent process; permission must separately cover
  video, landmarks, research analysis, retention, and any image publication.
- Confirm readiness and safety; record relevant limitations voluntarily disclosed.
- Capture setup metadata and calibration, then warm-up/familiarization (excluded).
- Record the six planned clip types with rests. Say the clip ID aloud or use a
  slate; never say the participant's name in study video.
- Immediately verify original video and tape readability; compute hashes; do not
  delete the originals after deriving landmarks.
- Collect usability responses before discussing system performance.

## After recording

- Create blinded annotation copies and expert annotations before system review.
- Open Studio → Analysis and select **Download research data**. Preserve the JSON
  unchanged and record its SHA-256 hash. It contains pseudonymous database records
  and landmark tapes, but no raw video or account identity.
- Freeze annotation file and hash it.
- Replay every eligible tape under both conditions; record config/output hashes.
- Capture one setup screenshot and condition outputs/failure screenshots with no
  participant identity. Screenshots supplement, never replace, machine logs.
- Randomize/blind feedback outputs for review; record all failures and exclusions.
- Run `python research/tools/analyze_pilot.py --input <run-directory>`.
- Resolve validation errors without changing observed results. Archive the full
  run immutably, then document any exploratory rerun as a new run ID.

## Required run-directory files

`participant_sessions.csv`, `trials.csv`, `phase_annotations.csv`,
`frame_predictions.csv`, `feedback_ratings.csv`, `usability_ratings.csv`,
`failure_log.csv`, and `artifact_manifest.csv`.
