# ACP-STGAT Model Rationale and Report Material

## Report placement

This material should be incorporated into:

- **Methodology:** ACP-STGAT architecture and design rationale
- **Results and Discussion:** per-horizon behavior, structural consistency,
  baselines and ablation results
- **Limitations:** kinematic assumptions, long-horizon uncertainty and skeleton
  constraints
- **Future Work:** horizon-dependent blending, phase conditioning and
  uncertainty-aware forecasting

Do not copy this note blindly into the thesis. The final wording and reported
values must match the executed notebook and final implementation.

## Recommended model name

Current project name:

> **Action-Conditioned Physics-Informed Spatio-Temporal Graph Attention
> Transformer (ACP-STGAT)**

More technically precise description:

> **An action-conditioned, kinematics-guided spatio-temporal graph-attention
> motion predictor**

The current prior uses position, velocity and acceleration. It does not model
mass, force, momentum, torque or physical contact. Therefore, **kinematic prior**
or **physics-inspired prior** is more accurate than claiming a complete
physics-informed simulation.

## Research purpose

ACP-STGAT predicts a sequence of future skeleton poses from recent observed
movement:

```text
Historical input: 60 skeleton frames
Prediction output: 30 future skeleton frames
```

### Level 2 awareness problem

Within the Combat Cognition Framework, Level 1 perception estimates what is
happening in the current frame, while Level 2 awareness must anticipate what is
likely to happen next. A purely reactive system cannot provide sufficient time
for early warning, defensive preparation, coaching or phase-transition
awareness. The design target was therefore an approximately one-second future
motion horizon.

At a 30 FPS input rate, one second corresponds to 30 predicted frames. This is
challenging because prediction uncertainty accumulates across the horizon and
velocity or acceleration observed in the current phase may reverse during the
next phase. For example, a Jab may transition from extension through its peak
into retraction within the prediction interval.

ACP-STGAT was developed as the Level 2 solution to this forecasting challenge.
It combines a useful short-term kinematic prior with learned temporal context,
skeleton-graph relationships, action conditioning and structural losses. The
aim is to predict the likely movement sequence while reducing the long-horizon
drift produced by kinematic extrapolation alone.

This should be described as the **design motivation and proposed solution**,
not as proof that one-second martial-arts prediction has been completely
solved. The Human3.6M benchmark provides architecture-level evidence; the live
MediaPipe-33 martial-arts evaluation must provide domain-specific evidence.

The model combines:

1. A short-horizon kinematic prior
2. A temporal Transformer
3. Anatomically masked graph attention
4. Action-conditioned joint gating
5. A learned future-pose decoder
6. Position, velocity, acceleration and bone-consistency losses

Each component addresses a different limitation of motion forecasting.

## Why a kinematic prior is useful

The kinematic estimate can be written as:

\[
\hat{\mathbf{P}}_{t+\Delta t}^{kin}
=
\mathbf{P}_t
+
\mathbf{V}_t\Delta t
+
\frac{1}{2}\mathbf{A}_t\Delta t^2
\]

where:

- \(\mathbf{P}_t\) is the most recent joint position
- \(\mathbf{V}_t\) is recent joint velocity
- \(\mathbf{A}_t\) is recent joint acceleration
- \(\Delta t\) is the prediction interval

For one or two future frames, recent velocity and acceleration can provide a
useful approximation because the movement state is unlikely to change
dramatically within such a short interval.

## Why kinematic-only forecasting fails over longer horizons

At 30 frames per second, a 30-frame prediction is approximately one second into
the future. Constant velocity or acceleration is unlikely to remain valid for the
whole second.

### Jab example

During the extension phase of a Jab:

```text
Observed state:
Fist moving forward
Forward velocity is high
Forward acceleration may be positive
```

A kinematic-only predictor may continue this movement:

```text
Forward movement
→ excessive arm extension
→ fist predicted far beyond the real peak
→ skeleton drift
→ possible structural deformation
```

The real movement normally changes phase:

```text
Extension
→ deceleration
→ peak
→ direction reversal
→ retraction
→ guard recovery
```

The kinematic prior cannot independently understand this phase transition.
Acceleration compounds the problem because its displacement contribution grows
quadratically with time.

Therefore:

- Kinematic extrapolation is most reliable at very short horizons.
- Direction or phase changes cause increasing long-horizon error.
- A kinematic prior cannot independently model movement intention.
- It must be corrected by learned temporal and structural components.

## Role of the temporal Transformer

The temporal Transformer examines relationships across the previous 60 frames.
It can learn:

- Movement rhythm
- Acceleration and deceleration patterns
- Preparation and execution patterns
- Likely movement-phase transitions
- Peak and retraction behavior
- Relationships between earlier and recent frames

Unlike constant acceleration, the temporal component can learn that rapid forward
movement may be followed by deceleration and retraction.

However, temporal learning alone can still produce:

- Statistically averaged futures
- Long-term drift
- Inconsistent joint trajectories
- Anatomically implausible limb configurations
- Uncertainty when several future actions are possible

A temporal model does not inherently know which joints are connected unless that
structure is represented explicitly.

## Role of graph-aware attention

The skeleton is represented as a graph:

```text
Joints = graph nodes
Bones  = graph edges
```

Examples:

```text
Shoulder → elbow → wrist
Pelvis → hip → knee → ankle
Pelvis → spine → neck → head
```

Graph-aware attention allows a joint prediction to use information from
anatomically related joints.

For a Jab:

```text
Shoulder rotation
→ elbow extension
→ wrist displacement
→ fist trajectory
```

The wrist should not be predicted independently from the elbow and shoulder.
Graph attention helps the model represent this coordinated kinematic chain.

## Graph attention is not a bone-length guarantee

Graph attention means:

> Anatomically connected joints exchange and prioritize information.

It does not mathematically guarantee:

- Constant bone lengths
- Valid joint-angle ranges
- Correct body proportions
- Anatomically possible poses

A graph model may still predict an excessively long forearm or an invalid
elbow–wrist relationship. Explicit structural losses or constrained
reconstruction are therefore required.

## Bone-length consistency

For connected joints \(i\) and \(j\), bone length is:

\[
L_{ij} = \|\mathbf{P}_i-\mathbf{P}_j\|_2
\]

The structural error can be expressed as:

\[
\mathcal{L}_{bone}
=
\frac{1}{N}
\sum_{(i,j)\in E}
\left|
L_{ij}^{pred}
-
L_{ij}^{true}
\right|
\]

where \(E\) is the set of skeleton edges.

The distinction is:

```text
Graph attention
= learns relationships between connected joints

Bone-length loss
= explicitly penalizes structural deformation
```

The two mechanisms are complementary.

## Role of action conditioning

Similar starting poses may have different futures:

```text
Guard → Jab
Guard → Cross
Guard → Block
Guard → remain stationary
```

Pose alone may not reveal the intended movement. The model therefore derives an
eight-value action context:

- Overall motion energy
- Shoulder movement
- Elbow movement
- Wrist movement
- Knee movement
- Acceleration energy
- Movement-progress proxy
- Movement-risk proxy

This context influences:

- Joint gating
- Temporal representation
- Learned future queries
- Kinematic-prior blending

For example, high elbow and wrist activity may increase the importance of the arm
chain during a Jab.

### Current limitation

The current action context is derived from kinematic measurements. It is not a
semantic label such as `JAB_RETRACTION`. A future version could condition the
predictor using probabilities from the temporal phase-classification model.

## Complete architectural rationale

```text
Kinematic prior
Provides short-horizon trajectory continuity
        +
Temporal Transformer
Learns non-linear movement evolution and phase changes
        +
Graph-aware attention
Models anatomical dependencies between connected joints
        +
Action-conditioned joint gating
Emphasizes movement-relevant joints and motion context
        +
Structural and temporal losses
Penalize position, velocity, acceleration and bone errors
        ↓
More coherent multi-frame skeleton prediction
```

No component alone solves the full forecasting problem:

- Kinematics provides continuity but may diverge.
- Temporal learning models change but may drift structurally.
- Graph attention models anatomical relationships but does not guarantee bone
  validity.
- Bone loss penalizes deformation but does not understand movement intention.
- Action conditioning adds context but remains dependent on observation quality.

## Recommended horizon-dependent blending

The reliability of the kinematic prior changes with prediction distance:

```text
Frames 1–2:
High trust in recent kinematics

Frames 3–10:
Balanced kinematic and learned prediction

Frames 11–30:
Lower trust in constant-motion extrapolation
Higher trust in learned temporal dynamics
```

A horizon-dependent mixture can be written as:

\[
\hat{\mathbf{P}}_{t+h}
=
g_h\mathbf{P}_{t+h}^{kin}
+
(1-g_h)\mathbf{P}_{t+h}^{learned}
\]

where \(g_h\) normally decreases as horizon \(h\) increases.

The current implementation produces a blend from the action context for the
prediction sequence. A stronger implementation would learn an independent gate
for every future frame and possibly every joint.

## Time-unit consistency

Velocity, acceleration and prediction time must use consistent units.

If position differences are calculated per frame:

\[
\mathbf{V}_t
=
\frac{\mathbf{P}_t-\mathbf{P}_{t-1}}{\Delta t}
\]

and:

\[
\mathbf{A}_t
=
\frac{\mathbf{V}_t-\mathbf{V}_{t-1}}{\Delta t}
\]

where \(\Delta t=1/fps\).

Using normalized horizon steps without consistently scaling velocity and
acceleration can under- or over-estimate displacement. The final model should
either:

1. Use seconds consistently with the recorded FPS, or
2. Use frame units consistently throughout all derivative and extrapolation
   calculations.

This should be verified before interpreting the kinematic prior as physically
meaningful.

## Recommended additional improvements

- Learn a separate kinematic blend for every prediction horizon.
- Apply acceleration clipping or damping.
- Predict root trajectory separately from local joint motion.
- Add explicit joint-angle constraints.
- Use stronger bone-length or forward-kinematics reconstruction.
- Condition on phase-classifier probabilities.
- Predict uncertainty or confidence by horizon.
- Generate multiple plausible future hypotheses.
- Add contact, balance and ground constraints.
- Weight near- and long-horizon losses differently.

## Required ablation study

The model’s component claims should be tested through ablation.

| Variant | Components | Research purpose |
|---|---|---|
| Kinematic-only | Position, velocity and acceleration extrapolation | Establish short-horizon baseline and drift |
| Temporal-only | Historical sequence and temporal Transformer | Test learned temporal dynamics |
| Graph-temporal | Temporal model with anatomical graph attention | Test spatial dependency contribution |
| Graph-temporal + bone loss | Graph-temporal model with structural penalty | Test skeleton consistency |
| Full ACP-STGAT | Kinematic prior, graph, temporal model, action conditioning and all losses | Test complete architecture |

Evaluate every variant using:

- Normalized MPJPE
- ADE
- FDE
- Per-horizon error
- Per-joint error
- Bone-length MAE
- Velocity error
- Acceleration error
- Inference latency

### Proposed ablation hypothesis

> Kinematic-only prediction is expected to remain competitive at the earliest
> forecast horizons but deteriorate as constant-motion assumptions become
> invalid. Temporal learning is expected to improve longer-horizon movement
> transitions, while graph-aware attention and bone-consistency loss are expected
> to reduce anatomical inconsistency. The complete ACP-STGAT architecture is
> expected to provide the strongest balance between short-term trajectory
> continuity, longer-term temporal behavior and skeleton structure.

This hypothesis must be tested; it must not be reported as an achieved result
before the ablation experiment is executed.

## Report-ready methodology paragraph

> ACP-STGAT combines a short-horizon kinematic prior with learned spatial and
> temporal reasoning. The kinematic component extrapolates recent joint position,
> velocity and acceleration, providing trajectory continuity over the earliest
> prediction frames. However, constant-motion assumptions become unreliable over
> longer horizons, particularly when a technique changes phase. For example,
> extrapolating the extension velocity of a Jab may place the predicted fist
> beyond its realistic peak instead of representing deceleration and retraction.
> A temporal Transformer therefore models non-linear movement evolution from the
> historical sequence, while anatomically masked graph attention represents
> dependencies within joint chains such as the shoulder, elbow and wrist. Because
> graph connectivity alone does not guarantee structural validity, bone-length,
> velocity and acceleration consistency terms are incorporated into the training
> objective. An action-context representation further gates joint importance and
> conditions future-pose decoding. The combined architecture is intended to
> produce forecasts that are more temporally and anatomically coherent than
> kinematic-only or temporal-only alternatives.

## Report-ready limitations paragraph

> The model’s physics-related component is limited to a kinematic prior and does
> not represent forces, mass, joint torque or physical contact. Constant velocity
> and acceleration are most defensible over short forecast intervals and may
> produce increasing displacement error when extrapolated through movement-phase
> changes. Graph-aware attention improves anatomical information exchange but
> does not mathematically guarantee valid bone lengths or joint angles. The
> deterministic future decoder also represents a single estimated future even
> when several future actions are plausible. These limitations motivate
> horizon-dependent prior blending, constrained skeletal reconstruction,
> phase-conditioned forecasting and uncertainty-aware multi-hypothesis prediction
> as future improvements.

## Results section requirements

After notebook execution, the report should include:

1. ACP-STGAT versus last-pose and constant-velocity baselines
2. Error at multiple future horizons
3. ADE and FDE
4. Bone-length error
5. Per-joint error
6. Robustness under noise and missing observations
7. Ablation results, if the ablation variants are implemented
8. Failure examples demonstrating drift or structural deformation
9. ONNX parity and runtime latency
10. Clear separation between Human3.6M-17 benchmark results and the deployed
    MediaPipe-33 system

Only results generated from the finalized executed notebook should be inserted
into the thesis.
