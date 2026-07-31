# Synthetic Temporal-Phase Data Methodology

## Report placement

This material should be incorporated into:

- **Methodology — Dataset development:** why bootstrap data was required and
  how it was generated;
- **Methodology — Temporal phase classification:** input representation,
  phase labels and training role;
- **Results:** clearly label the current experiment as synthetic bootstrap
  evaluation;
- **Limitations:** synthetic-to-real domain gap and absence of participant
  diversity; and
- **Future Work:** human recording, expert annotation and model retraining.

## Why synthetic data was used

At the current project stage, there is not enough human-verified, frame-level
martial-arts data to train and independently evaluate the temporal
phase-classification model. Ordinary martial-arts videos do not contain the
required synchronized MediaPipe-33 landmarks, exact phase boundaries,
technique identifiers, repetition identifiers, tracking-loss labels and
participant/session metadata.

Training on a very small set of recordings and randomly separating overlapping
frames would create severe overfitting and data leakage. The project therefore
used a controlled synthetic bootstrap dataset to develop and verify the
end-to-end data, training, evaluation and ONNX deployment pipeline before a
larger human dataset is available.

The synthetic data is an engineering bootstrap and possible pretraining
resource. It is not a substitute for human validation.

## Technically precise method name

Recommended description:

> **A procedural, state-machine-controlled, kinematics-informed MediaPipe-33
> skeleton sequence generator**

The generator may be described as physics-enriched because it calculates
kinematic descriptors such as joint angle, angular velocity, landmark
velocity, acceleration and motion energy. However, it is not a full
biomechanical physics simulator: it does not model mass, force, torque,
momentum, muscle activation, ground reaction force or contact dynamics.

## Dataset composition

The current bootstrap contains:

- 24 Jab sessions;
- 24 Front Kick sessions;
- 48 independent synthetic session identifiers;
- one to four repetitions per session;
- a nominal rate of 30 FPS;
- 33 MediaPipe-compatible landmarks; and
- x, y, z and visibility values for every landmark.

The dataset was generated using a fixed random seed so that the same source
bundle can be reproduced and hashed.

## Generation procedure

### 1. Base skeleton construction

A MediaPipe-compatible 33-landmark pose is created from parameterized body
geometry. Shoulder width, hip width and torso height are randomly varied to
represent limited synthetic differences in body proportions.

### 2. Technique state machine

Each technique is represented as an ordered sequence of native states.

Jab:

```text
GUARD
→ EXTENSION
→ FULL_EXTENSION
→ RETRACTION
→ RECOVERY
```

Front Kick:

```text
STANCE
→ CHAMBER
→ EXTENSION
→ RECOIL
→ RECOVERY
```

The state machine is also the label authority. It provides exact phase
segments and repetition identifiers without automatic or retrospective label
estimation.

### 3. Smooth phase trajectories

Joint positions are interpolated between phase-specific target poses. A cubic
smooth-step function,

\[
s(u)=u^2(3-2u),
\]

controls progression between zero and one. It produces continuous starts and
ends rather than abrupt linear jumps.

For a Jab, the lead elbow and wrist progress from guard through extension and
full extension, then return through retraction and recovery. For a Front Kick,
the hip, knee and ankle progress through chamber, extension, recoil and
recovery.

### 4. Controlled variation

Sessions vary:

- left/right execution side;
- movement speed and phase duration;
- number of repetitions;
- body proportions;
- camera yaw;
- coordinate noise;
- correct versus limited-range execution;
- complete versus incomplete repetitions; and
- brief landmark tracking loss.

Jab speed scale is sampled approximately from 0.55 to 1.65 and camera yaw from
-0.42 to +0.42 radians. Front-kick speed and yaw use similar bounded ranges.
Small Gaussian noise is added to landmark coordinates.

Incorrect-form examples reduce maximum extension. Incomplete examples omit
parts of the normal state sequence. Tracking-loss examples lower landmark
visibility for selected frames.

### 5. Kinematic enrichment

For the Jab generator, derived values include:

- lead-elbow angle;
- lead-elbow angular velocity;
- lead-wrist forward velocity;
- lead-wrist forward acceleration; and
- whole-pose motion energy.

These values enrich the generated record and support later analysis. The
current phase classifier itself receives normalized landmark x, y, z and
visibility channels; it does not directly receive all derived physics values.

### 6. Shared phase mapping

Technique-native states are mapped into the shared temporal vocabulary:

```text
PREPARATION
ENTRY
EXECUTION
PEAK
RETRACTION
RECOVERY
```

Special labels represent unknown and tracking-lost frames. A technique
embedding tells the model how to interpret the shared phases for each
technique.

### 7. Training windows and grouping

Landmarks are hip-centred and torso-scaled. The model receives 90-frame
windows with a stride of 15 frames.

All overlapping windows from one session remain in one split. The archived
experiment used:

- 32 training sessions;
- 8 validation sessions; and
- 8 test sessions.

Both techniques are represented in every split, and the same fixed split is
used for all three model seeds.

## What synthetic evaluation can demonstrate

Synthetic bootstrap evaluation can show that:

1. the data schema and preprocessing pipeline work;
2. the ST-GCN/TCN can learn generator-produced spatial and temporal patterns;
3. the model outperforms a simple baseline within the synthetic domain;
4. phase metrics, boundary metrics and robustness tests execute correctly;
5. the PyTorch model exports correctly to ONNX; and
6. the exported model has measurable model-only latency.

## What it cannot demonstrate

It cannot establish:

- real-human phase-classification accuracy;
- generalization to unseen practitioners;
- robustness to real camera, clothing, lighting or occlusion conditions;
- performance across different body mechanics and martial-art styles;
- clinical or biomechanical validity;
- real false-repetition rate on unrelated movement;
- deployed browser accuracy; or
- validity of the complete Combat Cognition Framework.

Because training and test sessions come from the same generator family, their
statistical and geometric patterns are related even though their session IDs
are separated. Synthetic performance will usually be more optimistic than
real-world performance.

## Future human-data and retraining plan

The next dataset stage should:

1. record consented videos from several practitioners;
2. retain original video for annotation audit;
3. export synchronized MediaPipe-33 landmarks and visibility;
4. include multiple camera angles, distances, speeds and execution sides;
5. include correct, incorrect, incomplete and interrupted movements;
6. record rest and unrelated movements for false-positive testing;
7. annotate phase boundaries and repetition identifiers manually;
8. have the expert researcher review labels using martial-arts and
   biomechanical knowledge;
9. obtain a second expert review for a subset where possible;
10. calculate inter-rater or intra-rater agreement;
11. split by participant before creating overlapping windows;
12. use synthetic data only for augmentation/pretraining, not human test data;
13. retrain or fine-tune the model on human training data;
14. select checkpoints and thresholds using human validation data; and
15. report final metrics once on an untouched human test set.

With only three participants, leave-one-participant-out evaluation is
recommended as a feasibility study. A later study should increase participant
diversity before making population-level claims.

## Report-ready methodology paragraph

> A sufficiently large human-verified dataset with frame-level martial-arts
> phase annotations was not available during the initial development stage.
> Consequently, a procedural, state-machine-controlled and
> kinematics-informed MediaPipe-33 skeleton generator was used to bootstrap the
> temporal phase-classification pipeline. The generator created 24 Jab and 24
> Front Kick sessions at a nominal 30 FPS. Technique-specific state machines
> controlled smooth landmark trajectories through preparation, execution,
> peak, retraction and recovery, while randomized body proportions, execution
> side, speed, camera yaw, landmark noise, incomplete repetitions, limited-range
> execution and tracking loss introduced controlled variation. Exact phase and
> repetition labels were obtained from the generator state machine. The
> synthetic data was used to verify preprocessing, grouped training,
> evaluation and ONNX deployment; it was not treated as evidence of real-human
> classification accuracy.

## Report-ready limitation and future-work paragraph

> The synthetic training and test sessions were generated by the same
> procedural model and therefore share its geometric assumptions and movement
> distributions. The resulting performance may overestimate generalization to
> real practitioners and camera conditions. Future work will collect
> consented, human-verified recordings with synchronized MediaPipe-33
> landmarks, expert-reviewed phase boundaries, participant identifiers,
> incorrect and incomplete attempts, tracking failures and unrelated movement.
> The classifier will then be retrained or fine-tuned using
> participant-separated training and validation data and evaluated on an
> untouched human test set. Synthetic sequences may remain as augmentation or
> pretraining data but will not be included in the final human test set.

