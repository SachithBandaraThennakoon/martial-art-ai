# Technique packages

Each enabled technique is declared in `index.json` and stored in a directory whose
name matches its stable technique ID.

Every technique requires:

- `catalog.json` for display, access, category, and commercial metadata.
- `training-steps.json` for instructional keyframes and target measurements.

Techniques using the whole-session temporal rule engine must also provide all six
tracking files:

- `manifest.json`
- `states.json`
- `transitions.json`
- `errors.json`
- `modes.json`
- `cues.json`

Partial tracking packages are rejected by both the frontend and backend loaders.
Add the package to `index.json` only after its required files are complete.

Shared schemas and profiles are stored in `_schemas` and `_profiles`. Technique IDs
must use lowercase kebab case and must remain stable after sessions reference them.

Use [CALIBRATION.md](CALIBRATION.md) when promoting a temporal package from
development to student-facing Train and Practice modes.
