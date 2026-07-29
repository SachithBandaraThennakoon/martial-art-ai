# Universal temporal model

The universal model uses one shared pose encoder and a learned technique
embedding. It predicts canonical phases, then runtime metadata maps those phases
back to each technique's native ordered states.

## Current mappings

- Jab
- Front Kick

Add a technique to `universal-labels.json` only after its manual annotation
labels and native state sequence are defined.

## Drive layout

```text
/content/drive/MyDrive/martial-art-ai/tapes/
  jab/*.json
  front-kick/*.json
  future-technique/*.json
```

Every included session must have complete manual annotations and
`manual_annotation.status = "human_verified"`. Synthetic sessions are excluded
unless `--include-synthetic` is explicitly supplied.

## Colab commands

```python
from google.colab import drive
drive.mount("/content/drive")

!git clone YOUR_REPOSITORY_URL /content/martial-art-ai
%cd /content/martial-art-ai
!pip -q install -r training/temporal_phase/requirements.txt

!python training/temporal_phase/prepare_universal_dataset.py \
  --input-dir "/content/drive/MyDrive/martial-art-ai/tapes" \
  --output "/content/universal_temporal_dataset.npz" \
  --sequence-length 90 \
  --stride 15

!python training/temporal_phase/train_universal_model.py \
  --dataset "/content/universal_temporal_dataset.npz" \
  --output-dir "/content/drive/MyDrive/martial-art-ai/models/universal-v1" \
  --epochs 60 \
  --batch-size 32
```

Copy the two exported runtime files to:

```text
frontend/public/models/universal-temporal/
  martial_arts_temporal.onnx
  martial_arts_temporal.metadata.json
```

The browser tries the universal model first. Until those files exist, Jab uses
its current trained model and other techniques retain their existing runtime.

## Responsibilities

The universal ONNX model performs phase classification. Ordered transitions,
tracking-loss handling and repetition completion remain deterministic runtime
guards. `training-steps.json` remains technique-specific and controls target
angles, scoring, visual corrections and coaching priority.
