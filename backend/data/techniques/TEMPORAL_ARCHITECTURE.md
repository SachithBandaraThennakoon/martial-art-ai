# Temporal tracking architecture

The tracking contract is deliberately hybrid. A technique must not depend on
count timing or a single frame label to create repetitions.

## Shared pipeline

1. Normalize pose, face, and hand landmarks.
2. Extract camera-scale-normalized biomechanical features.
3. Evaluate every configured technique state on every tracked frame.
4. Use the online temporal state machine for low-latency Train feedback.
5. Preserve the per-state evidence for the complete session.
6. In Practice mode, run the duration-aware offline decoder over that evidence.
7. Repair brief tracking gaps and reject impossible transitions.
8. Build repetitions only from a complete ordered state cycle.
9. Apply form-error rules and generate the corrected session summary.

The offline decoder is a global Viterbi-style decoder. It combines:

- state-rule emission scores;
- the configured transition map;
- minimum state durations;
- minimum confirmation-frame counts;
- maximum-duration penalties;
- an explicit unknown-movement state; and
- explicit tracking-loss intervals.

This prevents a locally attractive pose from skipping required states or creating
a repetition by itself.

## Mode responsibilities

Train mode remains causal: it uses only current and previous frames and provides
immediate cues. Practice mode is allowed to use the full recording and future
evidence to correct boundaries.

Count cues are metadata for response-time analysis. They never create or close a
movement repetition.

## Configuration

State rules and durations belong in `states.json`; allowed order belongs in
`transitions.json`. Practice decoder policy belongs under
`modes.practice.offline_decoder`.

Do not add technique-specific branches to the decoder. Add a technique package
with its own states, transitions, errors, and mode policy.

## Future learned models

DTW templates or a trained temporal model may later provide additional emission
scores. They must plug into step 3 and must not replace ordered decoding,
unknown-movement handling, tracking-loss handling, or rule-based verification.

