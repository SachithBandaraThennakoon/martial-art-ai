# Technique packages

Each enabled technique is declared in `index.json` and stored in a directory whose
name matches its stable technique ID.

Every technique requires:

- `catalog.json` for display, access, category, and commercial metadata.
- `training-steps.json` for instructional keyframes and target measurements.

## Training-step angle targets

Schema `2.0` uses one `angle_targets` list per step as the authoritative source
for joint ranges. Each target has:

- `body_part`, `min`, and `max` for the acceptable degree range.
- `target_angle` for the ideal reference pose rendered by the target skeleton.
- `label` for user-facing coaching.
- `role: "primary"` when it can score/identify the step.
- `role: "supporting"` when it informs the target skeleton, live values, and
  situation awareness without rejecting a repetition when tracking is missing.

The frontend derives the legacy scoring `angles`, full-body measurements, target
shape, and awareness target status from this single list. Do not duplicate angle
ranges in another step field.

Temporal runtime data should be embedded under
`training-steps.json.temporal_runtime`. Legacy technique packages may instead
provide the complete separate-file set:

- `manifest.json`
- `states.json`
- `transitions.json`
- `errors.json`
- `modes.json`

Partial legacy tracking packages are rejected by both loaders.
Add the package to `index.json` only after its required files are complete.

Shared schemas and profiles are stored in `_schemas` and `_profiles`. Technique IDs
must use lowercase kebab case and must remain stable after sessions reference them.

Use [CALIBRATION.md](CALIBRATION.md) when promoting a temporal package from
development to student-facing Train and Practice modes.

Use [TEMPORAL_ARCHITECTURE.md](TEMPORAL_ARCHITECTURE.md) for the stable online
Train and offline Practice decoding contract.
