# Temporal Phase Classifier Run 20260731T091140Z

## Evidence status

This is a complete **synthetic bootstrap pipeline evaluation** of the
technique-conditioned ST-GCN/TCN phase classifier. The experiment used 48
generated sessions: 24 Jab and 24 Front Kick.

It is a valid measured result for the synthetic experiment. It is not a
measurement of real-human accuracy.

Related data-method note:

[`../../../data/SYNTHETIC_TEMPORAL_PHASE_DATA_METHODOLOGY.md`](../../../data/SYNTHETIC_TEMPORAL_PHASE_DATA_METHODOLOGY.md)

## Is this a good result?

Yes, for the intended bootstrap purpose. The classifier materially outperformed
the technique-majority baseline, behaved consistently across three seeds,
located synthetic phase boundaries accurately and exported correctly to ONNX.
This demonstrates that the phase-classification training and deployment
pipeline is functioning.

The result is not sufficient to call the model real-world accurate or
state-of-the-art. Training and test sessions come from the same procedural
generator family. Human-recording performance may be substantially lower.

## Main results

| Metric | ST-GCN/TCN mean ± SD | Majority baseline |
|---|---:|---:|
| Accuracy | **87.84% ± 1.31 percentage points** | 33.49% |
| Balanced accuracy | **90.84% ± 0.71 percentage points** | 14.29% |
| Macro precision | **0.8803 ± 0.0113** | 0.0478 |
| Macro recall | **0.9084 ± 0.0071** | 0.1429 |
| Macro F1 | **0.8915 ± 0.0093** | 0.0717 |
| Weighted F1 | **0.8786 ± 0.0133** | 0.1680 |

Unlike the ACP-STGAT coordinate-regression experiment, accuracy is a valid
metric here because this model assigns discrete phase classes. Accuracy should
still be reported with balanced accuracy, macro F1 and per-phase metrics because
the classes are imbalanced.

The learned model improved accuracy by 54.35 percentage points over the
majority baseline. Its mean classification-error rate was approximately 12.16%
versus 66.51% for the baseline, an approximately 81.7% relative reduction in
classification error within the synthetic experiment.

## Seed consistency

| Seed | Accuracy | Balanced accuracy | Macro F1 | Validation macro F1 |
|---:|---:|---:|---:|---:|
| 42 | 87.42% | 90.09% | 0.8857 | 0.9063 |
| 43 | 86.79% | 90.94% | 0.8867 | **0.9246** |
| 44 | **89.31%** | **91.49%** | **0.9023** | 0.9064 |

Seed 43 was correctly selected for deployment because it had the highest
validation macro F1. Seed 44 had the highest test score, but selecting it using
test performance would introduce test-set bias.

The small across-seed standard deviations provide useful preliminary evidence
that the synthetic result is repeatable.

## Selected-model per-phase results

| Phase | Precision | Recall | F1 | Test support |
|---|---:|---:|---:|---:|
| Tracking lost | 1.000 | 1.000 | 1.000 | 2 |
| Preparation | 0.939 | 0.793 | 0.860 | 213 |
| Entry | 0.787 | 0.923 | 0.850 | 52 |
| Execution | 0.750 | 0.960 | 0.842 | 50 |
| Peak | 0.906 | 0.879 | 0.892 | 66 |
| Retraction | 0.867 | 0.934 | **0.899** | 91 |
| Recovery | 0.850 | 0.877 | 0.863 | 162 |

Retraction had the strongest ordinary-phase F1. Execution had high recall but
lower precision, meaning the model tended to predict execution for some frames
belonging to other phases. Preparation recall was the lowest ordinary-phase
recall, with some preparation frames confused with Entry, Execution and
Recovery.

The perfect tracking-loss score must not be emphasized because it is based on
only two test frames. That sample is far too small for a reliable
tracking-loss conclusion.

## Technique-level result

| Technique | Accuracy | Balanced accuracy | Reported macro F1 |
|---|---:|---:|---:|
| Jab | 83.99% | 85.48% | 0.6080 |
| Front Kick | 89.84% | 92.97% | 0.7830 |

Front Kick performed better than Jab in this split. The technique-level macro
F1 values use the experiment's global active-class list. Each technique does
not naturally contain every global phase, so these values are conservative and
should be interpreted with the accuracy, balanced accuracy and confusion
matrix.

Because Jab is the main representative evaluation technique, its lower result
is an important reason to collect human Jab data and retrain the model.

## Boundary timing

Across eight held-out synthetic sessions:

- mean boundary precision: **1.000**;
- mean boundary recall: **0.952**;
- mean boundary F1: **0.974**; and
- mean boundary timing error: **0.954 frames**.

At 30 FPS, 0.954 frames corresponds to approximately 31.8 milliseconds. These
are strong synthetic boundary results. They reflect generator-defined,
smoothly separated phases and may not transfer directly to ambiguous human
phase boundaries.

## Repetition/sequence result

- coarse repetition precision: **1.000**;
- coarse repetition recall: **0.8125**;
- repetition-count MAE: **0.375 repetitions per session**;
- true repetitions: 16;
- predicted repetitions: 13; and
- over-counted repetitions: 0.

All four Front Kick session counts were correct. Two multi-repetition Jab
sessions were under-counted:

- three true Jabs predicted as one; and
- three true Jabs predicted as two.

Therefore, the model and simple offline sequence diagnostic recognized phases
well but did not reliably recover every repeated Jab sequence. The
application's authoritative ordered decoder requires separate evaluation.

False repetitions per minute could not be measured because the bootstrap
contains no dedicated unrelated-movement negative sessions.

## Robustness

| Condition | Accuracy | Macro F1 |
|---|---:|---:|
| Clean | 86.79% | 0.8867 |
| Coordinate noise 0.005 | 86.95% | 0.8875 |
| Coordinate noise 0.010 | 87.11% | 0.8883 |
| 5% missing landmarks | 86.16% | 0.8810 |
| 10% missing landmarks | 83.65% | 0.8514 |

The small noise trials did not reduce this synthetic test score. This should be
interpreted as no measurable degradation in these particular trials, not as
evidence that noise improves the model.

Five-percent landmark loss caused a small decline. Ten-percent landmark loss
reduced accuracy by approximately 3.14 percentage points and macro F1 by
approximately 0.035. This indicates moderate tolerance but a meaningful
degradation as missing data increases.

## ONNX and latency

The ONNX deployment test passed:

- maximum PyTorch–ONNX error: `3.10 × 10^-6`;
- mean absolute error: `6.25 × 10^-7`;
- predicted labels identical: yes;
- parity threshold `1 × 10^-4`: passed;
- median CPU inference latency: **5.74 ms**; and
- 95th-percentile CPU inference latency: **30.49 ms**.

The p95 model-only latency is within a 33.3 ms frame interval at 30 FPS in this
test. This is promising deployment evidence, but camera capture, MediaPipe,
browser ONNX Runtime, preprocessing, decoder, situation awareness and feedback
latency are not included.

## Overall judgment

The correct conclusion is:

> The technique-conditioned ST-GCN/TCN is a successful synthetic-bootstrap
> prototype. It learned the generated temporal phase structure, strongly
> outperformed a majority baseline, produced accurate synthetic boundaries and
> exported successfully for real-time-oriented deployment. It remains
> unvalidated on real practitioners and under-counted some repeated synthetic
> Jabs. Human data collection, participant-separated evaluation and retraining
> are required before claiming real-world accuracy.

## Claims supported by this run

The report may state that:

1. the complete phase-model research pipeline was executed successfully;
2. the model outperformed the majority baseline on held-out synthetic sessions;
3. performance was consistent across three seeds;
4. generator-defined phase boundaries were detected with low timing error;
5. the model showed controlled degradation under simulated missing landmarks;
6. PyTorch and ONNX predictions agreed within the selected tolerance; and
7. model-only CPU latency was promising for real-time integration.

## Claims not supported by this run

The report must not claim that:

- real-human phase accuracy is 87.84%;
- the classifier is state of the art;
- performance generalizes to unseen practitioners;
- tracking-loss detection is perfect;
- Jab repetition counting is fully solved;
- the deployed browser has the same latency;
- false-repetition control has been validated; or
- the full Combat Cognition Framework has been validated.

## Future work

The project should collect human-verified recordings and retrain or fine-tune
the classifier. The final experiment should use participant-level separation,
expert-reviewed phase boundaries, correct and incorrect attempts, incomplete
repetitions, multiple speeds and camera conditions, tracking failures, rest and
unrelated movement. Synthetic data may remain in the training set as
augmentation or pretraining, but validation and test metrics must be calculated
from real human data.

## Report-ready results paragraph

> In the synthetic bootstrap experiment, the technique-conditioned ST-GCN/TCN
> achieved a mean frame accuracy of 87.84% (SD = 1.31 percentage points), a
> balanced accuracy of 90.84% (SD = 0.71 percentage points), and a macro F1 of
> 0.892 (SD = 0.009) across three training seeds. The technique-majority
> baseline achieved 33.49% accuracy and a macro F1 of 0.072. For the checkpoint
> selected using validation macro F1, mean phase-boundary precision and recall
> were 1.000 and 0.952 respectively, with a mean timing error of 0.954 frames.
> The offline sequence diagnostic recovered 13 of 16 repetitions without
> over-counting, but missed three repetitions in multi-Jab sessions. These
> findings validate the synthetic training and deployment pipeline but do not
> represent real-human accuracy because all sessions were produced by the same
> procedural generator family.

## Preserved evidence

The `evidence/` directory contains the files extracted from the submitted ZIP.
The original submitted archive and notebook source are preserved beside this
interpretation.

SHA-256:

- original output bundle:
  `A59925FE26B7958BFBE2AAD4B7704EC4F52C829E2CD34B171ACD0938C5F60825`
- source notebook:
  `CD4D27DAFD8F9119D51126213478AE95DD7C5B2C1CEC26A8482DAC7B864041E2`
- evaluated dataset:
  `BA308128027100F9AFCBC7787E71BD002108B0542412DB90AAB686C637B03B87`

