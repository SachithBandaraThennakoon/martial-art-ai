# ACP-STGAT run 20260731T061529Z: result interpretation

## Purpose and scope

This document interprets the measured outputs from the ACP-STGAT notebook run
`20260731T061529Z`. It is a report-supporting record, not a replacement for the
original output files.

The run evaluates a 17-joint, 3D, 30-frame motion-prediction model on a
participant-held-out Human3.6M public benchmark. It uses up to 10,000 test
windows and reports results across three random seeds: 42, 43, and 44.

In the Combat Cognition Framework, this model addresses the Level 2 awareness
requirement: moving beyond current-frame perception to anticipate approximately
one second of future movement. At 30 FPS, the 30-frame forecast represents that
one-second design target. The benchmark therefore tests the core forecasting
capability selected for Level 2, while martial-arts-specific system testing is
still required.

These results evaluate the motion-prediction model on a public general
human-motion benchmark. They do not directly evaluate:

- Jab-specific prediction;
- the live MediaPipe 33-landmark implementation;
- the complete Combat Cognition Framework;
- coaching correctness; or
- performance against published state-of-the-art motion-prediction models.

## Short answer

### Is this a good result?

Yes, within the experiment that was performed. ACP-STGAT produced lower
average and final-frame prediction errors than both included baselines. The
result was also reasonably consistent across three seeds. It is therefore a
successful model result and provides evidence that the learned model is more
effective than simply freezing the last pose or extending the last observed
velocity.

However, it should be described as a **promising and successful benchmark
result**, not yet as state-of-the-art performance. State-of-the-art claims
would require comparison with established published models under the same
dataset protocol.

### Is this a good model?

The evidence supports calling it a good prototype/research model for this
project because it:

- beats both simple prediction baselines;
- has low variation across three independent training seeds;
- controls long-horizon drift better than constant-velocity extrapolation;
- preserves skeletal structure substantially better than constant velocity;
- exports correctly to ONNX; and
- runs quickly enough to be a promising real-time component.

Its main current weaknesses are sensitivity to coordinate noise, the lack of
component-ablation results, the absence of comparison with published advanced
models, and the domain difference between Human3.6M-17 evaluation and the
live MediaPipe-33 martial-arts application.

### What is its accuracy?

There is no scientifically valid single "accuracy percentage" for this
regression task. Accuracy normally counts correct classifications. ACP-STGAT
predicts continuous 3D landmark coordinates, so it is evaluated using distance
errors: lower is better.

It would be incorrect to convert a normalized MPJPE of `0.07839` into
`92.16% accuracy`. The normalized error has no natural 100% upper bound and
cannot be subtracted from 100 in that way.

The clearest percentage statements available from this experiment are the
model's **relative error reductions against baselines**:

- 18.6% lower mean prediction error than last-pose prediction;
- 21.6% lower mean prediction error than constant velocity;
- 17.2% lower final-frame error than last-pose prediction; and
- 39.9% lower final-frame error than constant velocity.

If a percentage-style measure is required later, the evaluation can add a
predefined threshold metric such as PCK (Percentage of Correct Keypoints).
The threshold must be selected and justified before examining the results.

## Aggregate results

| Metric | ACP-STGAT, mean ± SD | Last pose | Constant velocity |
|---|---:|---:|---:|
| Normalized MPJPE / ADE | **0.07839 ± 0.00155** | 0.09629 | 0.10004 |
| Final displacement error | **0.13639 ± 0.00237** | 0.16470 | 0.22710 |
| Bone-length MAE | **0.00576 ± 0.00019** | approximately 0.00000 | 0.02487 |

In this implementation, normalized MPJPE and ADE are calculated equivalently.
They must not be presented as two independent findings.

The errors use normalized coordinates. They are not millimetres or centimetres.
Absolute physical-unit claims require an evaluation dataset with valid scale
and camera calibration.

## Results by seed

| Seed | Normalized MPJPE / ADE | Final displacement error | Bone-length MAE |
|---:|---:|---:|---:|
| 42 | 0.07741 | 0.13468 | 0.00569 |
| 43 | 0.07759 | 0.13539 | 0.00562 |
| 44 | 0.08018 | 0.13910 | 0.00597 |

The small across-seed standard deviations indicate that the result is not
dependent on one unusually favourable initialization. Three seeds provide
useful preliminary repeatability evidence, although more repetitions would
give a stronger uncertainty estimate.

## What the forecast-horizon result means

Prediction error increases with forecast distance for every method, which is
expected because uncertainty accumulates further into the future.

Constant velocity is highly competitive over the first few frames because
short-term human movement is locally smooth. Its error then rises rapidly as
the extrapolation continues. At frame 30:

- ACP-STGAT error is approximately `0.13468` for the best seed;
- last-pose error is approximately `0.16470`; and
- constant-velocity error is approximately `0.22710`.

This pattern supports the architectural motivation: a simple kinematic prior
is useful locally but insufficient for a long horizon. Learned temporal and
skeletal relationships help control drift when the motion changes direction,
decelerates, or transitions to another phase.

The result does not independently prove that every ACP-STGAT component is
responsible for the improvement. That causal claim requires the planned
ablation experiment.

## Bone-length interpretation

ACP-STGAT's bone-length MAE is much lower than constant velocity, supporting
better skeletal plausibility under long-horizon prediction.

The last-pose baseline has near-zero bone-length error because it copies an
unchanged skeleton. This does not make last pose a better motion predictor; it
preserves bone lengths trivially by predicting no movement. Bone-length error
must therefore be interpreted together with trajectory error.

## Robustness interpretation

| Input corruption | Normalized MPJPE | Change from clean result |
|---|---:|---:|
| None | 0.07741 | reference |
| Coordinate noise, SD 0.005 | 0.09167 | approximately +18.4% |
| Coordinate noise, SD 0.010 | 0.11645 | approximately +50.4% |
| 5% missing landmarks | 0.07792 | approximately +0.7% |
| 10% missing landmarks | 0.07864 | approximately +1.6% |

The model is relatively tolerant of the notebook's missing-landmark
simulation, but noticeably sensitive to coordinate noise. The live system
should therefore retain landmark smoothing, confidence filtering, and
short-gap interpolation. The missing-landmark result applies only to the
imputation/corruption procedure used by this notebook.

## ONNX and real-time suitability

The ONNX export passed the numerical parity check:

- maximum absolute PyTorch–ONNX difference: `1.19 × 10^-7`;
- mean absolute difference: `1.84 × 10^-9`;
- tolerance test at `1 × 10^-4`: passed;
- median CPU model-inference latency: `9.88 ms`; and
- 95th-percentile CPU model-inference latency: `12.81 ms`.

This demonstrates a correct export and promising model-only execution speed.
It does not prove the same latency for the complete browser pipeline. Camera
capture, MediaPipe inference, preprocessing, data transfer, visualization, and
coaching logic must be included in a separate end-to-end system latency test.

## Claims supported by this run

The report may state that:

1. ACP-STGAT outperformed last-pose and constant-velocity baselines on the
   held-out Human3.6M-17 benchmark used in this experiment.
2. The improvement was repeatable across three random seeds.
3. ACP-STGAT reduced long-horizon drift relative to constant velocity.
4. The exported ONNX model reproduced the PyTorch output within the selected
   numerical tolerance.
5. Model-only CPU latency was compatible with a real-time application in this
   test environment.
6. The model was more affected by landmark noise than by the simulated missing
   landmarks.

## Claims not supported by this run

The report must not claim from this result alone that:

- the model has `92.16% accuracy`;
- the error is measured in millimetres;
- ACP-STGAT is state of the art;
- ACP-STGAT is universally superior to other motion-prediction models;
- the MediaPipe-33 live model has the same error;
- Jab prediction has been validated;
- every architectural component is necessary; or
- the full Combat Cognition Framework has been validated.

## Additional evidence still required

For a stronger thesis evaluation, add:

1. an ablation study: kinematic-only, temporal-only, graph-temporal,
   graph-temporal plus bone loss, and the complete model;
2. one or more published motion-prediction comparison models under the same
   protocol;
3. a martial-arts/Jab dataset evaluation with ground-truth future frames;
4. MediaPipe-33 live-system qualitative examples and quantitative tests;
5. full-pipeline latency and frame-rate measurements;
6. threshold-based PCK if the institution expects a percentage measure; and
7. training/validation curves and predicted-versus-ground-truth skeleton
   visualizations for the report.

## Report-ready results paragraph

> On the participant-held-out Human3.6M 17-joint benchmark, ACP-STGAT achieved
> a mean normalized MPJPE/ADE of 0.07839 (SD = 0.00155) and a final
> displacement error of 0.13639 (SD = 0.00237) across three random seeds. The
> model reduced mean prediction error by 18.6% relative to the last-pose
> baseline and by 21.6% relative to constant-velocity extrapolation. At the
> final forecast frame, the corresponding error reductions were 17.2% and
> 39.9%. These findings show that the learned spatio-temporal model controlled
> long-horizon prediction drift more effectively than the two simple
> baselines. Because the evaluation used normalized Human3.6M 17-joint data,
> the results should be interpreted as an architecture benchmark rather than
> direct validation of the deployed MediaPipe 33-landmark martial-arts system.

## Preserved evidence

The `evidence/` directory contains the measured files exactly as extracted
from the submitted output archive. `original_output_bundle.zip` preserves the
submitted bundle, and `source_notebook.ipynb` records the notebook source held
in the project when the run was archived.

SHA-256 checksums:

- original output bundle:
  `893984476C8F847F90B5C9330B0E5930F3B6B4AFBCAA38B50F0E4861F1285816`
- source notebook:
  `8A8F44BF1F6AFCE058536EA464454A972B0C5C760D82D147CF6C52C72002D864`
