# ACP-STGAT Complete Train and Evaluate Colab — Guide

Companion notebook:
`ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`

Detailed architecture rationale and report-ready discussion:
[`../architecture/ACP_STGAT_MODEL_RATIONALE.md`](../architecture/ACP_STGAT_MODEL_RATIONALE.md)

## Purpose

This is a self-contained ACP-STGAT research experiment. A researcher can open the
notebook in Google Colab, select a GPU, run all cells, and obtain trained models,
held-out evaluation results, graphs, ONNX exports, latency measurements and a
downloadable results package.

## Complete workflow

```text
Install dependencies
    ↓
Initialize Andyen512/DDHpose repository
    ↓
Download the Human3.6M data linked by DDHPose
    ↓
Extract and normalize 17-joint motion sequences
    ↓
Split subjects into train, validation and test groups
    ↓
Create 60-frame input and 30-frame target windows
    ↓
Initialize and train ACP-STGAT using three seeds
    ↓
Evaluate held-out test data and forecasting baselines
    ↓
Run noise and missing-landmark robustness tests
    ↓
Export and verify the ONNX model
    ↓
Save provenance, figures, tables and results ZIP
```

## 1. Environment setup

The notebook installs:

- PyTorch
- NumPy and Pandas
- Scikit-learn
- Matplotlib and Seaborn
- Hugging Face Hub
- `gdown`
- ONNX and ONNX Runtime

It uses a CUDA GPU when one is available. A Colab T4 GPU is recommended.

## 2. DDHPose repository initialization

The notebook initializes the public repository using:

```python
snapshot_download(
    repo_id="Andyen512/DDHpose",
    repo_type="model",
    ...
)
```

The repository is downloaded under:

```text
/content/motion_data/DDHpose
```

The DDHPose repository and its research datasets are separate. The notebook
therefore downloads the processed Human3.6M archive linked by the DDHPose authors
in the following data-acquisition stage.

Synthetic fallback is disabled:

```python
USE_SYNTHETIC_FALLBACK = False
```

If real compatible data cannot be obtained, execution stops instead of silently
training on generated motion.

## 3. Experiment configuration

The default configuration is:

| Setting | Value |
|---|---:|
| Data mode | Human3.6M 17-joint public benchmark |
| Historical input | 60 frames |
| Prediction horizon | 30 frames |
| Coordinates | x, y and z |
| Window stride | 10 |
| Batch size | 32 |
| Maximum epochs | 60 |
| Early-stopping patience | 10 |
| Learning rate | 0.0003 |
| Weight decay | 0.0001 |
| Hidden dimension | 128 |
| Attention heads | 4 |
| Seeds | 42, 43 and 44 |

Three seeds are retained so the final result does not depend on one unusually
good or bad random initialization.

## 4. Human3.6M data preparation

The notebook:

1. Downloads the processed Human3.6M archive.
2. Extracts `data_3d_h36m.npz`.
3. Reads its `positions_3d` sequences.
4. Selects the standard 17-joint Human3.6M skeleton.
5. Excludes sequences shorter than 90 frames.
6. Retains subject and action/session identities.

No original video is required because the archive already contains numerical 3D
joint sequences.

Users of the notebook must review and follow the Human3.6M usage terms.

## 5. Normalization

Each skeleton sequence is normalized:

```text
Original 3D positions
    ↓
Subtract pelvis position
    ↓
Pelvis becomes the origin
    ↓
Calculate torso scale
    ↓
Divide coordinates by the torso scale
```

This reduces differences caused by global position and body scale. Consequently,
the reported values are normalized-coordinate errors, not millimetres.

## 6. Data validation

Every accepted sequence must match:

```text
[T, 17, 3]
```

where:

- `T` is the number of frames.
- `17` is the Human3.6M joint count.
- `3` represents x, y and z.

Incorrect joint counts, invalid coordinate dimensions and sequences shorter than
90 frames are rejected. The notebook does not repeat or arbitrarily select joints
to manufacture another skeleton definition.

## 7. Leakage-safe splitting

Subjects are divided before overlapping forecasting windows are generated:

```text
Human3.6M subjects
    ↓
Training subjects
Validation subjects
Test subjects
    ↓
Create windows separately within each split
```

This prevents similar windows belonging to the same subject/session from entering
both training and evaluation data.

The exact group assignments are saved in the provenance output.

## 8. Forecast windows

Every accepted sequence produces examples such as:

```text
Frames 1–60  → model input
Frames 61–90 → expected output

Frames 11–70  → next model input
Frames 71–100 → next expected output
```

Memory limits are applied:

- Up to 50,000 training windows
- Up to 10,000 validation windows
- Up to 10,000 test windows

## 9. ACP-STGAT input features

For every historical frame, the model uses:

- Joint position
- Joint velocity
- Joint acceleration

Velocity is calculated as:

```text
velocity(t) = position(t) − position(t−1)
```

Acceleration is:

```text
acceleration(t) = velocity(t) − velocity(t−1)
```

## 10. Spatial graph processing

The body is represented as a graph:

```text
Joints → nodes
Bones  → edges
```

Graph-aware attention follows the Human3.6M anatomical connections, including:

- Shoulder → elbow → wrist
- Pelvis → hip → knee → ankle
- Pelvis → spine → neck → head

## 11. Action context

An eight-value context is calculated from the historical sequence:

- Overall movement energy
- Shoulder movement
- Elbow movement
- Wrist movement
- Knee movement
- Acceleration energy
- Movement-progress proxy
- Movement-risk proxy

This context influences joint gating, temporal representation, future queries and
kinematic-prior blending.

The progress and risk values are internal model features, not independently
validated clinical measurements.

## 12. Temporal Transformer and decoder

Spatial joint features are combined into frame-level tokens. A temporal
Transformer models their relationships across the 60 historical frames.

Thirty learned future queries are then decoded:

```text
Historical movement representation
    +
Action context
    +
30 future queries
    ↓
30 predicted skeleton frames
```

The default output shape is:

```text
[batch, 30, 17, 3]
```

## 13. Kinematic prior

A basic future estimate is created from:

- Last observed pose
- Recent velocity
- Recent acceleration

Conceptually:

```text
future position =
last position
+ velocity contribution
+ acceleration contribution
```

The learned decoder predicts corrections to this estimate.

This is a kinematic prior, not a complete physical simulation. It does not model
mass, forces, joint torque or physical contact.

## 14. Training loss

The training objective combines:

- Joint-position error
- Velocity error
- Acceleration error
- Bone-length consistency error

These terms encourage positional accuracy, temporal consistency and anatomically
reasonable predictions.

## 15. Training process

The experiment is repeated with seeds 42, 43 and 44.

For each seed:

1. Initialize ACP-STGAT.
2. Train on the training subjects.
3. Measure validation normalized MPJPE after each epoch.
4. Save the best validation checkpoint.
5. Apply early stopping if validation performance stops improving.
6. Restore the best checkpoint.
7. Evaluate the untouched test set.

Test results do not select the checkpoint.

## 16. Forecasting baselines

### Last-pose baseline

Assumes that the body remains stationary:

```text
Every predicted frame = final observed frame
```

### Constant-velocity baseline

Continues the most recently observed velocity:

```text
Future position = last position + recent velocity × future step
```

ACP-STGAT should improve on these baselines to demonstrate useful learned
forecasting.

## 17. Evaluation metrics

### Normalized MPJPE

Mean Euclidean distance between predicted and actual joint positions.
Lower is better.

### ADE

Average Displacement Error over all predicted frames. Lower is better.

### FDE

Error on the final, most distant forecast frame. Lower is better.

### Bone-length MAE

Mean difference between predicted and actual bone lengths. Lower is better.

### Per-horizon error

Shows how error changes from predicted frame 1 to predicted frame 30.

### Per-joint error

Shows which anatomical joints are easier or more difficult to forecast.

Motion prediction is a coordinate-regression task. A general “accuracy
percentage” is not reported unless a threshold-based measure such as PCK is
predefined.

## 18. Robustness evaluation

The selected model is evaluated using:

- Small coordinate noise
- Larger coordinate noise
- 5% missing-landmark simulation
- 10% missing-landmark simulation

This shows how prediction quality changes when the observed pose is imperfect.

## 19. ONNX export and parity

The selected checkpoint is exported as:

```text
acp_stgat_17joint_motion_predictor.onnx
```

Default contract:

```text
Input:  [batch, 60, 17, 3]
Output: [batch, 30, 17, 3]
```

The same held-out batch is passed through PyTorch and ONNX Runtime. The notebook
records:

- Maximum absolute output difference
- Mean absolute output difference
- Whether predictions agree within `0.0001`
- Median CPU inference latency
- 95th-percentile CPU inference latency

Browser latency must be evaluated separately using ONNX Runtime Web.

## 20. Reproducibility information

The notebook saves:

- Complete experiment configuration
- Dataset SHA-256
- ONNX SHA-256
- Random seeds
- Subject/session splits
- Python, PyTorch, NumPy and Scikit-learn versions
- ONNX Runtime version
- Hardware/device
- Declared limitations

## 21. Final results package

The generated ZIP contains:

- Checkpoint for every training seed
- Training-history CSV files
- Test metrics for each run
- Mean and standard-deviation tables
- Complete metrics JSON
- Baseline results
- Robustness results
- Error-by-horizon figure
- Test-window manifest
- ONNX model
- ONNX parity and latency results
- Dataset and model hashes
- Provenance JSON

The executed `.ipynb` should also be downloaded because it preserves the visible
cell outputs and execution history.

## Research interpretation

The notebook produces public-dataset evidence for:

> ACP-STGAT motion forecasting using a Human3.6M 17-joint benchmark.

The application uses a different skeleton contract:

```text
Public benchmark: 17 Human3.6M joints
Live application: 33 MediaPipe landmarks
```

Therefore, Human3.6M results must not be described as the direct accuracy of the
deployed 33-landmark ONNX model. Direct deployment-model accuracy requires
MediaPipe-33 sequences or saved application landmark tapes.

## How to run

1. Open Google Colab.
2. Upload `ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`.
3. Select **Runtime → Change runtime type → T4 GPU**.
4. Select **Runtime → Run all**.
5. Wait for all three training runs and evaluation to finish.
6. Download the generated results ZIP.
7. Select **File → Download → Download .ipynb**.
8. Preserve both files as research evidence.
