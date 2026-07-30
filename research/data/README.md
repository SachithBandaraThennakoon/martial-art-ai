# Research data contracts

Raw participant videos may contain identifiable personal data. Keep them in an
access-controlled location outside Git. Commit only anonymized manifests and
derived landmarks when consent permits.

## Motion-prediction NPZ

The ACP-STGAT notebook expects:

- `sequences`: either `[N,T,33,3]` or an object array of `[T_i,33,3]`
- `session_ids`: string array of length `N`
- `participant_ids`: string array of length `N`
- `fps`: scalar or array of length `N` (recommended)

Coordinates must use one documented coordinate system. Values in MediaPipe
normalized coordinates must not be reported as millimetres. Missing samples may
be `NaN`; the notebook performs only temporal interpolation. It never invents an
anatomical mapping for a different joint definition.

## Temporal phase JSON

The phase notebook accepts a JSON list or `{ "sessions": [...] }`. Each session:

```json
{
  "session_id": "S001",
  "participant_id": "P001",
  "technique_id": "jab",
  "fps": 30,
  "frames": [
    {"timestamp_ms": 0, "landmarks": [[0.1, 0.2, -0.1, 0.99]]}
  ],
  "segments": [
    {"start_frame": 0, "end_frame": 20, "phase": "PREPARATION"}
  ],
  "annotation_status": "human_verified"
}
```

Each frame must contain exactly 33 landmarks with `[x,y,z,visibility]`.
`end_frame` is exclusive. Validation/test sessions must be `human_verified`.
Synthetic sessions may be used only for training and must be declared as such.

## Video and ground truth

For system evaluation, retain the original consented video in addition to the
application's compressed landmark/session recording. Expert phase annotation,
prediction, and system output must be stored separately to support blinded review.
