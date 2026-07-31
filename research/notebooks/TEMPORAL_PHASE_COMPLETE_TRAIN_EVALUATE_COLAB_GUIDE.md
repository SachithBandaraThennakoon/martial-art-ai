# Temporal Phase Complete Train and Evaluate Colab — Guide

Companion notebook:
`TEMPORAL_PHASE_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`

## Purpose

This is a standalone, shareable Google Colab for the
technique-conditioned ST-GCN/TCN temporal phase-classification model. It begins
with data acquisition and ends with a downloadable evidence package.

The default experiment uses the generated Jab + Front Kick bootstrap bundle:

`training/temporal_phase/samples/universal-jab-front-kick-bootstrap.json`

The notebook downloads the exact file from a pinned Git commit. A recipient
does not need this repository, a local project directory, a previous Colab run,
or an existing checkpoint.

## Critical interpretation

The default dataset is synthetic:

- 24 Jab sessions;
- 24 Front Kick sessions;
- 48 independent session IDs;
- generator-defined phase labels; and
- synthetic pose, speed, camera-yaw, noise, incomplete-motion and
  tracking-loss variations.

Therefore, the default experiment is a **synthetic bootstrap pipeline
evaluation**. Its scores can demonstrate that:

- data preparation works;
- the model can learn the generated phase patterns;
- session grouping prevents overlapping-window leakage;
- metrics and plots are produced correctly;
- the model exports to ONNX; and
- the exported model can execute with low numerical error and measurable
  latency.

Its scores must not be described as real-world human accuracy, population
performance, Jab mastery recognition, or validation of the complete Combat
Cognition Framework.

## Model contract

Input:

```text
landmarks:    [batch, 90, 33, 4]
technique_id: [batch]
```

The four landmark channels are:

```text
x, y, z, visibility
```

Output:

```text
phase_logits: [batch, 90, phase_classes]
```

Shared phase vocabulary:

1. `__PAD__`
2. `__UNKNOWN__`
3. `__TRACKING_LOST__`
4. `PREPARATION`
5. `ENTRY`
6. `EXECUTION`
7. `PEAK`
8. `RETRACTION`
9. `RECOVERY`

Technique-specific native labels are mapped into this shared vocabulary.

## Architecture

```text
90 MediaPipe-33 frames
        ↓
two spatial graph-convolution blocks
        ↓
visibility-weighted joint pooling
        ↓
learned technique embedding
        ↓
temporal convolutional network
        ↓
per-frame phase logits
```

The spatial graph layers model anatomical relationships between connected
MediaPipe landmarks. The temporal convolution layers model phase changes
across frames. The technique embedding tells the shared model whether the
sequence should be interpreted as a Jab or Front Kick.

The model generates phase probabilities. Legal ordering, tracking recovery and
authoritative repetition counting remain responsibilities of the deterministic
runtime decoder.

## Data acquisition

The default setting is:

```python
data_source = "github_sample"
```

This downloads:

```text
universal-jab-front-kick-bootstrap.json
```

from pinned project commit:

```text
c1ae68b540b2bb4c9b70da7ce0c8783a5a9e0aae
```

Expected SHA-256 for the current pinned bundle:

```text
BA308128027100F9AFCBC7787E71BD002108B0542412DB90AAB686C637B03B87
```

To use another compatible Temporal Data Lab bundle:

```python
data_source = "upload"
```

The notebook then opens Colab's upload control.

## Leakage protection

The prepared dataset contains overlapping 90-frame windows. The notebook
assigns complete sessions to fixed training, validation and test groups.
Windows from one session cannot cross those groups.

The split is stratified by technique so Jab and Front Kick appear in every
split. All three model seeds reuse the same groups.

Synthetic sessions do not have meaningful participant identities, so the
bootstrap uses session-level separation. Final human evaluation should use
participant-level separation. With three participants,
leave-one-participant-out evaluation is recommended.

## Training

Default training configuration:

| Setting | Value |
|---|---:|
| Input window | 90 frames |
| Window stride | 15 frames |
| Batch size | 32 |
| Maximum epochs | 60 |
| Early-stopping patience | 10 |
| Learning rate | 0.0003 |
| Weight decay | 0.0001 |
| Hidden size | 96 |
| Dropout | 0.20 |
| Training seeds | 42, 43, 44 |

Class weights are calculated from training frames. Validation macro-F1 selects
each checkpoint. Test labels are not used for optimization or checkpoint
selection.

## Main evaluation metrics

The results include:

- frame accuracy;
- balanced accuracy;
- macro precision;
- macro recall;
- macro F1;
- weighted F1;
- per-phase precision, recall, F1 and support;
- per-technique metrics; and
- a confusion matrix.

Unlike motion-coordinate prediction, phase classification can legitimately
report accuracy. However, accuracy alone may hide weak performance on short or
minority phases. Macro-F1 and per-phase results are therefore required.

## Complete-timeline evaluation

Overlapping test-window probabilities are averaged back into complete session
timelines. Each original held-out frame is counted once in the main test
metrics.

The test prediction table records:

- session;
- technique;
- frame index;
- true phase;
- predicted phase; and
- predicted confidence.

## Baseline

The notebook compares the trained model with a technique-conditioned majority
baseline. For each technique, that baseline always predicts the most frequent
training phase.

A useful learned model should materially outperform this baseline, especially
in balanced accuracy and macro-F1.

## Phase-boundary evaluation

Predicted labels receive a five-frame majority filter before boundary
evaluation. A predicted transition matches a true transition only when:

1. both transitions enter the same phase; and
2. their frame difference is within five frames.

Reported boundary results include:

- precision;
- recall;
- F1; and
- mean absolute timing error in frames.

At 30 FPS, five frames represent approximately 167 milliseconds.

## Repetition/sequence diagnostic

The notebook uses canonical technique orders:

```text
Jab:
PREPARATION → EXECUTION → PEAK → RETRACTION → RECOVERY

Front Kick:
PREPARATION → ENTRY → PEAK → RETRACTION → RECOVERY
```

It reports per-session true and predicted completed-sequence counts plus count
MAE and coarse precision/recall.

This is an offline diagnostic. It is not a replacement for evaluation of the
application's authoritative ordered decoder.

The bootstrap contains no dedicated unrelated-motion sessions, so false
repetitions per minute cannot be measured in this run.

## Robustness

The selected model is tested under:

| Condition | Meaning |
|---|---|
| Clean | Original prepared inputs |
| Noise 0.005 | Gaussian noise added to normalized xyz |
| Noise 0.010 | Stronger Gaussian coordinate noise |
| Missing 5% | Random landmarks hidden |
| Missing 10% | More random landmarks hidden |

The notebook reports accuracy, balanced accuracy and F1 metrics for every
condition.

## ONNX verification

The notebook exports:

```text
martial_arts_temporal.onnx
```

The same held-out example is passed through PyTorch and ONNX Runtime. The
results include:

- maximum and mean absolute logit difference;
- whether predicted labels are identical;
- parity pass/fail at `0.0001`;
- median CPU model latency;
- 95th-percentile CPU model latency; and
- ONNX SHA-256.

This measures model-only Python/ONNX Runtime latency. Browser inference and
camera-to-feedback system latency must be measured separately.

## Expected output package

The timestamped ZIP should contain:

- `checkpoint_seed_42.pt`
- `checkpoint_seed_43.pt`
- `checkpoint_seed_44.pt`
- three training-history CSV files
- `metrics_by_run.csv`
- `metrics_summary.csv`
- `classification_report.json`
- `metrics_by_technique.csv`
- `confusion_matrix.png`
- `test_frame_predictions.csv`
- `boundary_metrics_by_session.csv`
- `repetition_counts_by_session.csv`
- `sequence_summary.json`
- `robustness.csv`
- `martial_arts_temporal.onnx`
- `onnx_parity_latency.json`
- `raw_dataset_audit.csv`
- `split_groups.csv`
- `model_metadata.json`
- `provenance.json`

## Expected outcome

No accuracy value is hard-coded or guaranteed. A successful execution should:

1. validate 48 synthetic sessions and two techniques;
2. produce disjoint train, validation and test session groups;
3. complete all three training seeds;
4. outperform the majority baseline;
5. produce usable per-phase and transition results;
6. pass ONNX parity at `0.0001`;
7. record CPU model latency; and
8. download one complete evidence ZIP.

A very high synthetic score is possible because training and test sessions
come from the same generator family. It means the model learned the synthetic
phase patterns. It does not demonstrate equivalent performance on camera
recordings of people.

## How to run

1. Open Google Colab.
2. Upload `TEMPORAL_PHASE_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`.
3. Select **Runtime → Change runtime type → T4 GPU**.
4. Select **Runtime → Run all**.
5. Allow the bootstrap file and Python dependencies to download.
6. Wait for all three training runs and evaluations.
7. Download the automatically generated results ZIP.
8. Use **File → Download → Download .ipynb** to preserve the executed notebook.
9. Return both the ZIP and executed notebook for result interpretation.

## Evidence required after the bootstrap

For thesis-level real-world phase-model evidence, repeat the notebook using:

- human-verified Temporal Data Lab exports;
- participant-separated evaluation;
- several practitioners;
- varied speeds, sides, camera positions and distances;
- correct, incorrect, incomplete and interrupted techniques;
- tracking-loss examples;
- unrelated movement and rest periods; and
- the deployed ordered decoder for repetition evaluation.

