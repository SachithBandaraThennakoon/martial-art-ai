# Temporal phase model

For the shared multi-technique pipeline, use
[`UNIVERSAL_MODEL.md`](UNIVERSAL_MODEL.md). The original commands below remain
available for reproducing the legacy Jab-only model.

This folder starts the long-term hybrid recognition pipeline:

1. MediaPipe Pose 33 produces landmark sequences.
2. A compact ST-GCN/TCN predicts per-frame technique-state probabilities.
3. The existing ordered decoder enforces valid transitions, durations,
   tracking-loss recovery, and complete repetitions.
4. Biomechanical rules score form only after boundaries are confirmed.

The learned model is an emission source. It never counts repetitions directly.

## Synthetic bootstrap data

Generate varied Jab sequences with exact 30 FPS timestamps, different speeds,
body proportions, lead sides, camera yaw, landmark noise, incomplete movement,
incorrect form, tracking loss, angles, velocity and acceleration:

```powershell
python training/temporal_phase/generate_synthetic_sequences.py `
  --output training/temporal_phase/data/jab-synthetic-bootstrap.json `
  --sessions 60 `
  --seed 42
```

Synthetic sequences are explicitly marked in `provenance.origin`. They are for
pipeline testing and bootstrap pretraining. Never report synthetic-only test
scores as evidence that the model works on people.

## Important data note

The Admin Temporal Data Lab is a standalone recorder. It reads the technique
and state definitions, but it does not load or modify Practice sessions. Frames
are captured only between **Start recording** and **Stop**. Select timeline
ranges, apply their true states manually, review the full timeline, add the
recording to the local queue, and export the verified JSON bundle. The dataset
builder rejects every session that is not marked `human_verified`.

## 1. Collect sessions

For the first experiment, collect at least:

- 20 sessions to verify the pipeline;
- 50–100 sessions for a useful prototype;
- several participants, camera distances, speeds, and viewing angles;
- correct, incorrect, incomplete, interrupted, and unrelated movements.

Do not split frames from the same session across training and testing. The
provided training script uses session-level groups.

## 2. Export recordings

Open **Admin Studio → Temporal Data Lab**, record and manually label each
attempt, then choose **Export JSON for Colab**. Put one or more exported JSON
bundles in a private Drive directory. No API token or Practice-session download
is required.

## 3. Use Google Colab

Create a GPU Colab notebook and run these cells.

### Clone and install

```python
!git clone YOUR_REPOSITORY_URL /content/martial-art-ai
%cd /content/martial-art-ai
!pip -q install -r training/temporal_phase/requirements.txt
```

### Mount Drive

Upload the exported JSON bundles to a private Drive directory first.

```python
from google.colab import drive
drive.mount("/content/drive")
```

### Build the dataset

```python
!python training/temporal_phase/prepare_dataset.py \
  --input-dir "/content/drive/MyDrive/martial-art-ai/tapes/jab" \
  --output "/content/jab_temporal_dataset.npz" \
  --technique jab \
  --states PATH_TO_EXTRACTED_JAB_STATES.json \
  --sequence-length 90 \
  --stride 15
```

To deliberately include synthetic bootstrap bundles, add
`--include-synthetic`. Without that flag, the builder rejects them.
The Jab runtime state document is now embedded in
`backend/data/techniques/jab/training-steps.json` under `temporal_runtime.states`.
New multi-technique training should use `prepare_universal_dataset.py`.

### Train and export ONNX

```python
!python training/temporal_phase/train_phase_model.py \
  --dataset "/content/jab_temporal_dataset.npz" \
  --output-dir "/content/drive/MyDrive/martial-art-ai/models/jab-v1" \
  --epochs 60 \
  --batch-size 32
```

The output directory contains:

- `best_temporal_phase.pt`
- `temporal_phase_classifier.onnx`
- `temporal_phase_classifier.metadata.json`
- `test_report.json`

## 4. Acceptance gates

Do not enable the model in production based only on training loss or frame
accuracy. Require:

- session-separated test data;
- macro F1 reported for every movement state;
- repetition precision and recall after ordered decoding;
- false repetitions per minute on unrelated movement;
- boundary timing error;
- tests on participants absent from training;
- comparison against the rule-only decoder.

Initially run the learned model in shadow mode. Record its probabilities and
compare results without changing user-visible repetition counts.

## Runtime contract

`frontend/src/tracking/temporalModelContract.js` validates model metadata,
converts logits to probabilities, and blends sufficiently confident learned
evidence with rule scores. The rule decoder remains authoritative.
