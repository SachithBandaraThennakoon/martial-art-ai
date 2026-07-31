# Audit of the supplied ACP-STGAT Colab notebook

Audit date: 2026-07-31

## Source

- Shared file: `acp_stgat_motion_prediction_mediapipe33_colab (1).ipynb`
- User-provided Drive URL:
  `https://drive.google.com/file/d/1xCo1I4--ru8ChdscibqJPSBsN10ivoMp/view`
- Hugging Face source used by the notebook:
  `https://huggingface.co/Andyen512/DDHpose`

## Provenance finding

The notebook attempted:

```text
Trying Hugging Face download: Andyen512/DDHpose
Fetching 25 files
Found .npz files: 0
```

It then reported:

```text
No real compatible data found. Using synthetic fallback for smoke testing only.
Files scanned: 0
Compatible real sequences: 0
Training sequences: 1200
```

Therefore, the downloaded Hugging Face repository was not a compatible
MediaPipe-33 dataset. The training run used 1,200 generated synthetic sequences.

The DDHPose model card describes the repository as the official implementation of
DDHPose and states that its experiments use separately downloaded Human3.6M and
MPI-INF-3DHP data. Those datasets are not included as MediaPipe-33 sequences in
the repository snapshot.

## Recorded run information

- Model label: ACP-STGAT
- Parameters: approximately 1.334 million
- Input: `[1,60,33,3]`
- Output: `[1,30,33,3]`
- Synthetic sequences: 1,200
- Overlapping windows: 21,663
- Training windows: 18,414
- Validation windows: 3,249
- Batch size: 48
- Epochs shown: 12
- Training loss reduced from approximately 0.09503 to 0.08746
- Validation loss remained approximately 0.08775
- ONNX export completed and its tensor shapes were verified

## What this run demonstrates

- The model code executes.
- The training loop executes.
- The checkpoint and ONNX export pipeline execute.
- The ONNX model accepts the tensor shape used by the browser system.
- The live-system screenshot can demonstrate integration and visualization.

## What this run does not demonstrate

- Real-human motion-prediction accuracy
- Generalization to unseen participants
- Martial-arts-domain accuracy
- Performance on Human3.6M or MPI-INF-3DHP
- A leakage-free independent test result
- Improvement over last-pose or constant-velocity baselines

The reported validation loss must be described as a **synthetic pipeline/smoke
test**, not as real-data accuracy.

## Methodological issues corrected in the research notebooks

1. Synthetic fallback cannot silently become the final experiment.
2. Participant/session groups are split before overlapping windows are created.
3. A held-out test set is required.
4. Non-33-joint data are rejected rather than evenly sampled or padded by
   repeating joints.
5. Baselines, horizon metrics, robustness, repeated seeds and ONNX parity are
   included.
6. Deployment checkpoint selection uses validation results, never test results.

## Required next evidence

Create a MediaPipe-33 dataset from consented recorded videos or exported system
landmark tapes, then run the research ACP-STGAT evaluation notebook. Human3.6M or
MPI-INF-3DHP may be evaluated separately as 17-joint benchmarks, but they cannot
be described as the directly deployed 33-landmark model without an explicit,
anatomically valid conversion and separate validation.
