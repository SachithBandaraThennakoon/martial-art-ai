"""Generate the two research Colab notebooks.

The generator keeps notebook JSON reviewable and makes it easy to rebuild clean
copies after a methodological change. It does not execute experiments or create
results.
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = ROOT / "notebooks"


def md(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": textwrap.dedent(source).strip().splitlines(keepends=True),
    }


def code(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": textwrap.dedent(source).strip().splitlines(keepends=True),
    }


def notebook(cells: list[dict]) -> dict:
    return {
        "cells": cells,
        "metadata": {
            "accelerator": "GPU",
            "colab": {"name": "", "provenance": []},
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


PREP_CELLS = [
    md(
        """
        # Prepare a real MediaPipe-33 motion dataset from videos

        This notebook converts consented recorded videos into the exact landmark
        format required by the deployed ACP-STGAT model:

        - sequence: `[T,33,3]`
        - history: 60 frames
        - forecast target: 30 frames
        - coordinates: MediaPipe normalized `x`, `y`, and relative-depth `z`

        It does **not** manufacture missing anatomical joints and does not use
        synthetic motion as final evaluation evidence.

        The Hugging Face repository `Andyen512/DDHpose` contains DDHPose code and
        model assets. Its Human3.6M/MPI-INF-3DHP datasets are separate 17-joint
        resources and are not a direct MediaPipe-33 dataset.
        """
    ),
    md(
        """
        ## 0. Video naming and privacy

        Rename each video before upload:

        `participant_id__session_id__technique.ext`

        Example: `P001__S001__jab.mp4`

        Use anonymous participant IDs. Keep consent forms and identifiable raw
        video outside a public repository.
        """
    ),
    code(
        """
        !pip -q install mediapipe opencv-python-headless pandas matplotlib
        """
    ),
    code(
        """
        import hashlib, json, os, re, shutil
        from pathlib import Path

        import cv2
        import matplotlib.pyplot as plt
        import mediapipe as mp
        import numpy as np
        import pandas as pd

        VIDEO_DIR = Path("/content/videos")
        OUTPUT_DIR = Path("/content/prepared_motion_data")
        MODEL_PATH = Path("/content/pose_landmarker_full.task")
        OUTPUT_NPZ = OUTPUT_DIR / "motion_sequences_mediapipe33.npz"
        TARGET_FPS = 30.0
        MIN_FRAMES = 90  # 60 observed + 30 future
        VIDEO_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        """
    ),
    md(
        """
        ## 1. Upload videos

        You may upload several videos at once. For a larger dataset, mount Google
        Drive and set `VIDEO_DIR` to the relevant folder instead.
        """
    ),
    code(
        """
        from google.colab import files
        uploaded = files.upload()
        for name, content in uploaded.items():
            (VIDEO_DIR / Path(name).name).write_bytes(content)
        print("Uploaded videos:", len(uploaded))
        """
    ),
    md(
        """
        ## 2. Download the official MediaPipe Pose Landmarker model

        This model performs landmark extraction only. It is not the ACP-STGAT
        forecasting model.
        """
    ),
    code(
        """
        if not MODEL_PATH.exists():
            import urllib.request
            urllib.request.urlretrieve(
                "https://storage.googleapis.com/mediapipe-models/"
                "pose_landmarker/pose_landmarker_full/float16/latest/"
                "pose_landmarker_full.task",
                MODEL_PATH,
            )
        print("Pose model bytes:", MODEL_PATH.stat().st_size)
        """
    ),
    md(
        """
        ## 3. Extract MediaPipe-33 sequences

        Frames without a detected pose are represented by `NaN`. The evaluation
        notebook performs within-sequence temporal interpolation and rejects a
        landmark coordinate with fewer than two valid observations.
        """
    ),
    code(
        """
        BaseOptions = mp.tasks.BaseOptions
        PoseLandmarker = mp.tasks.vision.PoseLandmarker
        PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
        RunningMode = mp.tasks.vision.RunningMode

        VIDEO_PATTERN = re.compile(
            r"^(?P<participant>[^_]+)__(?P<session>[^_]+)__(?P<technique>[^.]+)"
        )

        def parse_video_name(path):
            match = VIDEO_PATTERN.match(path.name)
            if not match:
                raise ValueError(
                    f"{path.name!r} must follow participant__session__technique.ext"
                )
            return match.groupdict()

        def sha256_file(path, block_size=1 << 20):
            digest = hashlib.sha256()
            with open(path, "rb") as handle:
                for block in iter(lambda: handle.read(block_size), b""):
                    digest.update(block)
            return digest.hexdigest()

        def extract_video(path, landmarker, target_fps):
            capture = cv2.VideoCapture(str(path))
            source_fps = float(capture.get(cv2.CAP_PROP_FPS) or target_fps)
            step = max(1, round(source_fps / target_fps))
            output_fps = source_fps / step
            sequence, source_index, detected = [], 0, 0
            while True:
                ok, bgr = capture.read()
                if not ok:
                    break
                if source_index % step:
                    source_index += 1
                    continue
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                timestamp_ms = int(round(source_index * 1000 / source_fps))
                result = landmarker.detect_for_video(image, timestamp_ms)
                if result.pose_landmarks:
                    pose = result.pose_landmarks[0]
                    landmarks = np.asarray(
                        [[point.x, point.y, point.z] for point in pose],
                        dtype=np.float32,
                    )
                    if landmarks.shape != (33, 3):
                        raise ValueError(f"Unexpected landmark shape: {landmarks.shape}")
                    detected += 1
                else:
                    landmarks = np.full((33, 3), np.nan, dtype=np.float32)
                sequence.append(landmarks)
                source_index += 1
            capture.release()
            return np.asarray(sequence, dtype=np.float32), source_fps, output_fps, detected

        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        video_paths = sorted(
            path for path in VIDEO_DIR.iterdir()
            if path.suffix.lower() in {".mp4", ".mov", ".avi", ".mkv", ".webm"}
        )
        if not video_paths:
            raise ValueError("No supported videos were uploaded.")

        sequences, participants, sessions, techniques, fps_values, quality_rows = (
            [], [], [], [], [], []
        )
        with PoseLandmarker.create_from_options(options) as landmarker:
            for path in video_paths:
                identity = parse_video_name(path)
                sequence, source_fps, output_fps, detected = extract_video(
                    path, landmarker, TARGET_FPS
                )
                coverage = detected / max(len(sequence), 1)
                accepted = len(sequence) >= MIN_FRAMES and coverage >= 0.80
                quality_rows.append({
                    "file_name": path.name,
                    **identity,
                    "source_fps": source_fps,
                    "output_fps": output_fps,
                    "output_frames": len(sequence),
                    "tracking_coverage": coverage,
                    "accepted": accepted,
                    "video_sha256": sha256_file(path),
                })
                print(path.name, sequence.shape, f"coverage={coverage:.1%}", "accepted=", accepted)
                if accepted:
                    sequences.append(sequence)
                    participants.append(identity["participant"])
                    sessions.append(identity["session"])
                    techniques.append(identity["technique"])
                    fps_values.append(output_fps)

        quality = pd.DataFrame(quality_rows)
        display(quality)
        if not sequences:
            raise ValueError(
                "No video passed the minimum 90-frame and 80% tracking requirements."
            )
        """
    ),
    md(
        """
        ## 4. Quality checks and dataset export

        A final three-participant experiment needs at least three distinct
        participant IDs, with participant grouping used for train/validation/test.
        More participants and multiple sessions per participant are preferable.
        """
    ),
    code(
        """
        quality.to_csv(OUTPUT_DIR / "video_extraction_quality.csv", index=False)
        sequence_array = np.empty(len(sequences), dtype=object)
        sequence_array[:] = sequences
        np.savez_compressed(
            OUTPUT_NPZ,
            sequences=sequence_array,
            participant_ids=np.asarray(participants),
            session_ids=np.asarray(sessions),
            technique_ids=np.asarray(techniques),
            fps=np.asarray(fps_values, dtype=np.float32),
        )
        summary = {
            "accepted_sequences": len(sequences),
            "participants": len(set(participants)),
            "sessions": len(set(sessions)),
            "techniques": sorted(set(techniques)),
            "total_frames": int(sum(len(sequence) for sequence in sequences)),
            "landmark_schema": "MediaPipe33",
            "coordinate_system": "normalized_image_xyz",
            "minimum_frames": MIN_FRAMES,
            "minimum_tracking_coverage": 0.80,
            "dataset_sha256": sha256_file(OUTPUT_NPZ),
        }
        print(json.dumps(summary, indent=2))
        with open(OUTPUT_DIR / "dataset_summary.json", "w") as handle:
            json.dump(summary, handle, indent=2)
        if summary["participants"] < 3:
            print("WARNING: fewer than three participants; participant-independent "
                  "train/validation/test evaluation is not possible.")
        """
    ),
    code(
        """
        # Visual sanity check: trajectories for selected landmarks.
        sample = sequences[0]
        for joint in (0, 11, 12, 15, 16, 23, 24, 27, 28):
            plt.plot(sample[:, joint, 0], label=str(joint), alpha=0.8)
        plt.xlabel("Frame"); plt.ylabel("Normalized x")
        plt.title("Selected landmark trajectories"); plt.legend(ncol=3)
        plt.tight_layout(); plt.show()
        """
    ),
    md(
        """
        ## 5. Expected outputs

        A successful run produces:

        - `motion_sequences_mediapipe33.npz`
        - `video_extraction_quality.csv`
        - `dataset_summary.json`
        - printed participant/session/frame counts and dataset SHA-256

        Upload the NPZ to `01_acp_stgat_research_evaluation.ipynb`. The numerical
        model metrics are intentionally not predicted in advance; they must come
        from the held-out data.
        """
    ),
    code(
        """
        archive = shutil.make_archive(
            "/content/prepared_motion_data", "zip", OUTPUT_DIR
        )
        print("Archive:", archive)
        from google.colab import files
        files.download(archive)
        """
    ),
]


MOTION_CELLS = [
    md(
        """
        # ACP-STGAT — end-to-end training and research evaluation

        This single notebook downloads/prepares data, trains ACP-STGAT, evaluates
        a held-out test set, compares forecasting baselines, checks robustness,
        and exports/verifies ONNX.

        Default mode uses the processed **Human3.6M data linked by DDHPose** and
        trains a 17-joint public-benchmark variant without requiring videos.
        Optional `mediapipe33_npz` mode trains the application-compatible
        33-landmark variant from system tapes or prepared landmark sequences.

        **Reporting rule:** normalized-coordinate errors are not millimetres.
        Smoke tests, synthetic samples, and validation scores must not be reported
        as real-world test accuracy.
        """
    ),
    md(
        """
        ## Standalone design

        This notebook is self-contained and can be shared with another researcher.
        It initializes the DDHPose repository, downloads the processed Human3.6M
        data linked by that repository, prepares the sequences, trains ACP-STGAT
        from scratch, evaluates it, and packages all outputs.

        The model uses a 60→30 forecasting contract, pose/velocity/acceleration
        features, eight-value action context, joint gating, graph-aware attention,
        a temporal Transformer, future decoder, kinematic prior and ONNX export.

        Synthetic fallback is disabled because final evaluation must stop rather
        than silently replace missing real data.
        """
    ),
    md(
        """
        ## 0. Runtime setup

        Run this in a fresh Colab runtime. For the final thesis experiment, save
        the executed notebook and the complete timestamped output directory.
        """
    ),
    code(
        """
        !pip -q install onnx onnxruntime scikit-learn pandas seaborn gdown huggingface_hub
        """
    ),
    code(
        """
        import glob, hashlib, json, math, os, platform, random, re, shutil, subprocess, time
        from dataclasses import asdict, dataclass
        from datetime import datetime, timezone
        from pathlib import Path

        import matplotlib.pyplot as plt
        import numpy as np
        import pandas as pd
        import seaborn as sns
        import sklearn
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        from sklearn.model_selection import GroupShuffleSplit
        from torch.utils.data import DataLoader, Dataset

        print("Python:", platform.python_version())
        print("PyTorch:", torch.__version__)
        print("CUDA:", torch.cuda.is_available())
        DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        """
    ),
    md(
        """
        ## 1. Initialize the DDHPose repository

        This downloads the public DDHPose code/model repository into the Colab
        workspace. The repository and its processed research dataset are separate:
        the following data-acquisition section downloads the Human3.6M archive
        linked by the DDHPose authors.
        """
    ),
    code(
        """
        from huggingface_hub import snapshot_download

        DATA_DIR = Path("/content/motion_data")
        DDHPOSE_DIR = DATA_DIR / "DDHpose"
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        USE_SYNTHETIC_FALLBACK = False

        try:
            print("Initializing Hugging Face repository: Andyen512/DDHpose")
            snapshot_download(
                repo_id="Andyen512/DDHpose",
                repo_type="model",
                local_dir=str(DDHPOSE_DIR),
                ignore_patterns=["*.pth", "*.pt", "*.ckpt"],
            )
        except Exception as error:
            print("Repository initialization warning:", repr(error))

        repository_npz_files = sorted(
            glob.glob(str(DDHPOSE_DIR / "**" / "*.npz"), recursive=True)
        )
        print("Repository .npz files:", len(repository_npz_files))
        for path in repository_npz_files[:10]:
            print(path)
        print("Synthetic fallback enabled:", USE_SYNTHETIC_FALLBACK)
        """
    ),
    md(
        """
        ## 2. Predeclared configuration

        Use at least three seeds for the final experiment. A single seed is useful
        only while checking the pipeline. Do not tune after observing the test set.
        """
    ),
    code(
        """
        # Choose one:
        # - "h36m17_public_benchmark": automatic public benchmark; no videos needed.
        # - "mediapipe33_npz": exact application skeleton; supply a documented NPZ.
        DATA_MODE = "h36m17_public_benchmark"

        @dataclass
        class Config:
            data_path: str = "/content/prepared_h36m17.npz"
            output_root: str = "/content/research_outputs/acp_stgat"
            history: int = 60
            horizon: int = 30
            joints: int = 17
            coords: int = 3
            stride: int = 10
            batch_size: int = 32
            epochs: int = 60
            patience: int = 10
            learning_rate: float = 3e-4
            weight_decay: float = 1e-4
            hidden_dim: int = 128
            heads: int = 4
            temporal_layers: int = 2
            dropout: float = 0.1
            test_fraction: float = 0.20
            validation_fraction_of_remaining: float = 0.25
            seeds: tuple = (42, 43, 44)
            default_fps: float = 30.0
            max_train_windows: int = 50000
            max_evaluation_windows: int = 10000

        CFG = Config()
        if DATA_MODE == "mediapipe33_npz":
            CFG.data_path = "/content/motion_sequences_mediapipe33.npz"
            CFG.joints = 33
        elif DATA_MODE != "h36m17_public_benchmark":
            raise ValueError(f"Unsupported DATA_MODE: {DATA_MODE}")
        RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        RUN_DIR = Path(CFG.output_root) / RUN_ID
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        print(asdict(CFG))
        print("Output:", RUN_DIR)
        """
    ),
    md(
        """
        ## 3. End-to-end public-data acquisition

        In default mode this cell downloads `data.rar`, the processed Human3.6M
        archive linked from the official DDHPose model card, extracts
        `data_3d_h36m.npz`, applies the standard VideoPose3D 17-joint subset,
        normalizes each sequence, and writes the grouped NPZ consumed below.

        Review the Human3.6M terms before use and record the download date/source
        in the thesis dataset manifest.
        """
    ),
    code(
        """
        H36M_DRIVE_ID = "1FMgAf_I04GlweHMfgUKzB0CMwglxuwPe"
        H36M_KEEP_17 = [0,1,2,3,6,7,8,12,13,14,15,17,18,19,25,26,27]

        def normalize_h36m_sequence(sequence):
            sequence = np.asarray(sequence, dtype=np.float32)
            sequence = sequence - sequence[:, :1, :]  # pelvis origin
            torso = np.linalg.norm(sequence[:, 8] - sequence[:, 0], axis=-1)
            valid = torso[np.isfinite(torso) & (torso > 1e-6)]
            if not len(valid):
                raise ValueError("Cannot determine a valid H36M torso scale.")
            return sequence / float(np.median(valid))

        def flatten_h36m_positions(positions):
            sequences, participants, sessions = [], [], []
            for subject, actions in sorted(positions.items()):
                for action, value in sorted(actions.items()):
                    arrays = list(value) if isinstance(value, (list, tuple)) else [value]
                    for camera_index, raw in enumerate(arrays):
                        array = np.asarray(raw, dtype=np.float32)
                        if array.ndim != 3 or array.shape[-1] != 3:
                            continue
                        if array.shape[1] >= 28:
                            array = array[:, H36M_KEEP_17, :]
                        if array.shape[1:] != (17, 3) or len(array) < 90:
                            continue
                        sequences.append(normalize_h36m_sequence(array))
                        participants.append(str(subject))
                        safe_action = re.sub(r"[^A-Za-z0-9-]+", "-", str(action)).strip("-")
                        sessions.append(f"{subject}__{safe_action}__cam{camera_index}")
            if not sequences:
                raise ValueError("No compatible Human3.6M sequences were extracted.")
            return sequences, participants, sessions

        if DATA_MODE == "h36m17_public_benchmark":
            import gdown
            archive_path = Path("/content/ddhpose_h36m_data.rar")
            extract_dir = Path("/content/ddhpose_h36m_data")
            if not archive_path.exists():
                gdown.download(id=H36M_DRIVE_ID, output=str(archive_path), quiet=False)
            extract_dir.mkdir(parents=True, exist_ok=True)
            if not list(extract_dir.rglob("data_3d_h36m.npz")):
                subprocess.run(["apt-get", "-qq", "update"], check=True)
                subprocess.run(
                    ["apt-get", "-qq", "install", "-y", "unar"], check=True
                )
                subprocess.run(
                    ["unar", "-f", "-o", str(extract_dir), str(archive_path)],
                    check=True,
                )
            candidates = list(extract_dir.rglob("data_3d_h36m.npz"))
            if len(candidates) != 1:
                raise ValueError(f"Expected one data_3d_h36m.npz, found {candidates}")
            source_npz = candidates[0]
            source_payload = np.load(source_npz, allow_pickle=True)
            if "positions_3d" not in source_payload.files:
                raise KeyError(f"positions_3d missing; keys={source_payload.files}")
            h36m_sequences, h36m_participants, h36m_sessions = flatten_h36m_positions(
                source_payload["positions_3d"].item()
            )
            object_sequences = np.empty(len(h36m_sequences), dtype=object)
            object_sequences[:] = h36m_sequences
            np.savez_compressed(
                CFG.data_path,
                sequences=object_sequences,
                participant_ids=np.asarray(h36m_participants),
                session_ids=np.asarray(h36m_sessions),
                fps=np.full(len(h36m_sequences), 50.0, dtype=np.float32),
            )
            print(
                "Prepared H36M17:", len(h36m_sequences), "sequences,",
                len(set(h36m_participants)), "subjects"
            )
            print("Source archive:", archive_path)
            print("Prepared dataset:", CFG.data_path)
        else:
            print("Upload/copy the MediaPipe-33 NPZ to:", CFG.data_path)
        """
    ),
    md(
        """
        ## 4. Strict data loading and provenance

        Expected NPZ keys are `sequences`, `session_ids`, `participant_ids`, and
        optionally `fps`. Every sequence must match `[T,CFG.joints,3]`. A different
        skeleton is rejected; evenly selecting or repeating joints would be
        anatomically invalid. Missing values are interpolated only along time
        within the same landmark and coordinate.
        """
    ),
    code(
        """
        def sha256_file(path, block_size=1 << 20):
            digest = hashlib.sha256()
            with open(path, "rb") as handle:
                for block in iter(lambda: handle.read(block_size), b""):
                    digest.update(block)
            return digest.hexdigest()

        def temporal_interpolate(sequence):
            sequence = np.asarray(sequence, dtype=np.float32).copy()
            t = np.arange(len(sequence))
            for joint in range(sequence.shape[1]):
                for coord in range(sequence.shape[2]):
                    values = sequence[:, joint, coord]
                    valid = np.isfinite(values)
                    if valid.sum() < 2:
                        raise ValueError(
                            f"Landmark {joint}, coordinate {coord} has fewer than "
                            "two valid samples; exclude or recollect this sequence."
                        )
                    sequence[:, joint, coord] = np.interp(t, t[valid], values[valid])
            return sequence

        def load_motion_npz(path, cfg):
            payload = np.load(path, allow_pickle=True)
            required = {"sequences", "session_ids", "participant_ids"}
            missing = required.difference(payload.files)
            if missing:
                raise KeyError(f"Missing NPZ keys: {sorted(missing)}")
            sequences = [np.asarray(x, dtype=np.float32) for x in payload["sequences"]]
            session_ids = np.asarray(payload["session_ids"]).astype(str)
            participant_ids = np.asarray(payload["participant_ids"]).astype(str)
            if not (len(sequences) == len(session_ids) == len(participant_ids)):
                raise ValueError("Sequences and ID arrays must have equal length.")
            fps_raw = payload["fps"] if "fps" in payload.files else cfg.default_fps
            fps = np.full(len(sequences), float(fps_raw)) if np.ndim(fps_raw) == 0 else np.asarray(fps_raw, float)
            if len(fps) != len(sequences):
                raise ValueError("fps must be scalar or one value per sequence.")
            cleaned = []
            for index, sequence in enumerate(sequences):
                if sequence.ndim != 3 or sequence.shape[1:] != (cfg.joints, cfg.coords):
                    raise ValueError(
                        f"Sequence {index} is {sequence.shape}; expected [T,{cfg.joints},{cfg.coords}]."
                    )
                if len(sequence) < cfg.history + cfg.horizon:
                    raise ValueError(f"Sequence {index} is too short.")
                cleaned.append(temporal_interpolate(sequence))
            return cleaned, session_ids, participant_ids, fps

        sequences, session_ids, participant_ids, sequence_fps = load_motion_npz(CFG.data_path, CFG)
        print("Sequences:", len(sequences))
        print("Participants:", len(np.unique(participant_ids)))
        print("Sessions:", len(np.unique(session_ids)))
        print("Dataset SHA-256:", sha256_file(CFG.data_path))
        """
    ),
    md(
        """
        ## 5. Leakage-safe grouped split and window creation

        Participant grouping is preferred. If fewer than three participants exist,
        session grouping is used and the limitation must be stated. The test split
        remains untouched during model selection.
        """
    ),
    code(
        """
        def grouped_indices(participants, sessions, cfg, seed):
            preferred = participants if len(np.unique(participants)) >= 3 else sessions
            group_name = "participant" if preferred is participants else "session"
            indices = np.arange(len(preferred))
            outer = GroupShuffleSplit(
                n_splits=1, test_size=cfg.test_fraction, random_state=seed
            )
            train_val, test = next(outer.split(indices, groups=preferred))
            inner_groups = preferred[train_val]
            inner = GroupShuffleSplit(
                n_splits=1,
                test_size=cfg.validation_fraction_of_remaining,
                random_state=seed + 1,
            )
            train_rel, val_rel = next(inner.split(train_val, groups=inner_groups))
            train, val = train_val[train_rel], train_val[val_rel]
            for left, right in ((train, val), (train, test), (val, test)):
                assert set(preferred[left]).isdisjoint(set(preferred[right]))
            return {"train": train, "validation": val, "test": test}, group_name

        def make_windows(sequence_indices, sequences, sessions, participants, fps, cfg, limit):
            references = []
            for seq_index in sequence_indices:
                sequence = sequences[seq_index]
                stop = len(sequence) - cfg.history - cfg.horizon + 1
                for start in range(0, stop, cfg.stride):
                    references.append((int(seq_index), int(start)))
            if len(references) > limit:
                rng = np.random.default_rng(CFG.seeds[0])
                chosen = np.sort(rng.choice(len(references), size=limit, replace=False))
                references = [references[index] for index in chosen]
            past, future, rows = [], [], []
            for seq_index, start in references:
                boundary = start + cfg.history
                past.append(sequences[seq_index][start:boundary])
                future.append(
                    sequences[seq_index][boundary:boundary + cfg.horizon]
                )
                rows.append({
                        "sequence_index": int(seq_index),
                        "session_id": sessions[seq_index],
                        "participant_id": participants[seq_index],
                        "start_frame": int(start),
                        "fps": float(fps[seq_index]),
                })
            if not past:
                raise ValueError("A split produced no windows.")
            return np.stack(past), np.stack(future), pd.DataFrame(rows)

        split_indices, GROUP_LEVEL = grouped_indices(
            participant_ids, session_ids, CFG, CFG.seeds[0]
        )
        split_data = {
            name: make_windows(
                ids, sequences, session_ids, participant_ids, sequence_fps, CFG,
                CFG.max_train_windows if name == "train" else CFG.max_evaluation_windows
            )
            for name, ids in split_indices.items()
        }
        for name, (x, y, table) in split_data.items():
            print(name, x.shape, "groups:", table[f"{GROUP_LEVEL}_id"].nunique())
        """
    ),
    md(
        """
        ## 6. Dataset and graph-aware ACP-STGAT

        Spatial attention is masked by the MediaPipe body graph. The network uses
        position, velocity, and acceleration features, temporal attention, learned
        future queries, and a constant-velocity kinematic prior. “Kinematic prior”
        is the accurate term; it is not a complete physics simulator.
        """
    ),
    code(
        """
        MEDIAPIPE_EDGES = [
            (0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),(9,10),
            (11,12),(11,13),(13,15),(15,17),(15,19),(15,21),(17,19),
            (12,14),(14,16),(16,18),(16,20),(16,22),(18,20),
            (11,23),(12,24),(23,24),(23,25),(25,27),(27,29),(29,31),
            (27,31),(24,26),(26,28),(28,30),(30,32),(28,32)
        ]
        H36M17_EDGES = [
            (0,1),(1,2),(2,3),(0,4),(4,5),(5,6),
            (0,7),(7,8),(8,9),(9,10),
            (8,11),(11,12),(12,13),(8,14),(14,15),(15,16)
        ]
        SKELETON_EDGES = (
            MEDIAPIPE_EDGES if CFG.joints == 33 else H36M17_EDGES
        )

        def adjacency_matrix(joints=33):
            matrix = torch.eye(joints, dtype=torch.bool)
            for a, b in SKELETON_EDGES:
                matrix[a, b] = matrix[b, a] = True
            # Two-hop neighbors improve information flow while preserving locality.
            numeric = matrix.float()
            return ((numeric @ numeric) > 0)

        class MotionDataset(Dataset):
            def __init__(self, past, future):
                self.past = torch.as_tensor(past, dtype=torch.float32)
                self.future = torch.as_tensor(future, dtype=torch.float32)
            def __len__(self):
                return len(self.past)
            def __getitem__(self, index):
                return self.past[index], self.future[index]

        class MaskedGraphAttention(nn.Module):
            def __init__(self, dim, heads, dropout, joints):
                super().__init__()
                assert dim % heads == 0
                self.heads, self.head_dim = heads, dim // heads
                self.qkv = nn.Linear(dim, dim * 3)
                self.proj = nn.Linear(dim, dim)
                self.dropout = nn.Dropout(dropout)
                self.norm1 = nn.LayerNorm(dim)
                self.norm2 = nn.LayerNorm(dim)
                self.ff = nn.Sequential(
                    nn.Linear(dim, dim * 2), nn.GELU(), nn.Dropout(dropout),
                    nn.Linear(dim * 2, dim)
                )
                self.register_buffer("graph_mask", adjacency_matrix(joints))

            def forward(self, x):
                # x: [B,T,J,D]
                b, t, j, d = x.shape
                z = self.norm1(x).reshape(b * t, j, d)
                qkv = self.qkv(z).reshape(b * t, j, 3, self.heads, self.head_dim)
                q, k, v = qkv.unbind(dim=2)
                q, k, v = [item.transpose(1, 2) for item in (q, k, v)]
                scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)
                scores = scores.masked_fill(~self.graph_mask[None, None], -1e4)
                attended = torch.softmax(scores, dim=-1) @ v
                attended = attended.transpose(1, 2).reshape(b, t, j, d)
                x = x + self.dropout(self.proj(attended))
                return x + self.dropout(self.ff(self.norm2(x)))

        class ACPSTGAT(nn.Module):
            def __init__(self, cfg):
                super().__init__()
                self.cfg = cfg
                self.input = nn.Linear(cfg.coords * 3, cfg.hidden_dim)
                self.spatial = MaskedGraphAttention(
                    cfg.hidden_dim, cfg.heads, cfg.dropout, cfg.joints
                )
                temporal_layer = nn.TransformerEncoderLayer(
                    d_model=cfg.hidden_dim, nhead=cfg.heads,
                    dim_feedforward=cfg.hidden_dim * 4,
                    dropout=cfg.dropout, batch_first=True, norm_first=True
                )
                self.temporal = nn.TransformerEncoder(
                    temporal_layer, num_layers=cfg.temporal_layers
                )
                self.action_context = nn.Sequential(
                    nn.Linear(8, cfg.hidden_dim), nn.GELU(),
                    nn.Linear(cfg.hidden_dim, cfg.hidden_dim)
                )
                self.joint_gate = nn.Sequential(
                    nn.Linear(cfg.hidden_dim, cfg.hidden_dim), nn.GELU(),
                    nn.Linear(cfg.hidden_dim, cfg.joints), nn.Sigmoid()
                )
                self.future_queries = nn.Parameter(
                    torch.randn(cfg.horizon, cfg.hidden_dim) * 0.02
                )
                self.decoder = nn.TransformerDecoder(
                    nn.TransformerDecoderLayer(
                        d_model=cfg.hidden_dim, nhead=cfg.heads,
                        dim_feedforward=cfg.hidden_dim * 4,
                        dropout=cfg.dropout, batch_first=True, norm_first=True
                    ),
                    num_layers=2,
                )
                self.output = nn.Linear(cfg.hidden_dim, cfg.joints * cfg.coords)
                self.physics_blend = nn.Sequential(
                    nn.Linear(cfg.hidden_dim, cfg.hidden_dim), nn.GELU(),
                    nn.Linear(cfg.hidden_dim, 1), nn.Sigmoid()
                )

            def forward(self, past):
                velocity = torch.diff(past, dim=1, prepend=past[:, :1])
                acceleration = torch.diff(velocity, dim=1, prepend=velocity[:, :1])
                features = torch.cat((past, velocity, acceleration), dim=-1)
                spatial = self.spatial(self.input(features))
                speed = torch.linalg.vector_norm(velocity, dim=-1)
                accel = torch.linalg.vector_norm(acceleration, dim=-1)
                if self.cfg.joints == 33:
                    shoulder, elbow, wrist, knee = [11,12], [13,14], [15,16], [25,26]
                    left_wrist, right_wrist = 15, 16
                else:
                    shoulder, elbow, wrist, knee = [11,14], [12,15], [13,16], [2,5]
                    left_wrist, right_wrist = 13, 16
                motion_energy = speed.mean(dim=(1,2))
                accel_energy = accel.mean(dim=(1,2))
                symmetry = torch.linalg.vector_norm(
                    past[:, -1, left_wrist] - past[:, -1, right_wrist], dim=-1
                )
                action = torch.stack((
                    motion_energy,
                    speed[:, :, shoulder].mean(dim=(1,2)),
                    speed[:, :, elbow].mean(dim=(1,2)),
                    speed[:, :, wrist].mean(dim=(1,2)),
                    speed[:, :, knee].mean(dim=(1,2)),
                    accel_energy,
                    torch.sigmoid((motion_energy - motion_energy.mean()) * 8.0),
                    torch.sigmoid((accel_energy + symmetry) * 2.0),
                ), dim=-1)
                action_embed = self.action_context(action)
                joint_weights = self.joint_gate(action_embed)[:, None, :, None]
                tokens = (spatial * (0.5 + joint_weights)).mean(dim=2)
                memory = self.temporal(tokens) + action_embed[:, None]
                queries = (
                    self.future_queries[None].expand(len(past), -1, -1)
                    + action_embed[:, None]
                )
                learned = self.output(self.decoder(queries, memory)).reshape(
                    len(past), self.cfg.horizon, self.cfg.joints, self.cfg.coords
                )
                last_velocity = past[:, -1] - past[:, -2]
                previous_velocity = past[:, -2] - past[:, -3]
                last_acceleration = last_velocity - previous_velocity
                steps = torch.arange(
                    1, self.cfg.horizon + 1, device=past.device, dtype=past.dtype
                )[None, :, None, None] / self.cfg.horizon
                prior = (
                    past[:, -1:, :, :]
                    + steps * last_velocity[:, None]
                    + 0.5 * steps.square() * last_acceleration[:, None]
                )
                blend = self.physics_blend(action_embed)[:, None, None, :]
                return prior + (1.0 - blend) * learned
        """
    ),
    md(
        """
        ## 7. Loss, training, and early stopping

        Model selection uses validation normalized MPJPE only. The held-out test
        set is evaluated once after restoring the best validation checkpoint.
        """
    ),
    code(
        """
        BONES = torch.tensor(SKELETON_EDGES, dtype=torch.long)

        def bone_lengths(x):
            bones = BONES.to(x.device)
            return torch.linalg.vector_norm(x[..., bones[:,0], :] - x[..., bones[:,1], :], dim=-1)

        def motion_loss(prediction, target):
            position = torch.linalg.vector_norm(prediction - target, dim=-1).mean()
            pred_v, true_v = torch.diff(prediction, dim=1), torch.diff(target, dim=1)
            velocity = F.l1_loss(pred_v, true_v)
            acceleration = F.l1_loss(torch.diff(pred_v, dim=1), torch.diff(true_v, dim=1))
            bone = F.l1_loss(bone_lengths(prediction), bone_lengths(target))
            return position + 0.25 * velocity + 0.10 * acceleration + 0.10 * bone

        @torch.no_grad()
        def validation_mpjpe(model, loader):
            model.eval()
            total, count = 0.0, 0
            for past, future in loader:
                prediction = model(past.to(DEVICE))
                errors = torch.linalg.vector_norm(prediction - future.to(DEVICE), dim=-1)
                total += errors.sum().item()
                count += errors.numel()
            return total / count

        def seed_everything(seed):
            random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

        def train_one_seed(seed, train_arrays, val_arrays, cfg):
            seed_everything(seed)
            generator = torch.Generator().manual_seed(seed)
            train_loader = DataLoader(
                MotionDataset(*train_arrays), batch_size=cfg.batch_size,
                shuffle=True, generator=generator
            )
            val_loader = DataLoader(
                MotionDataset(*val_arrays), batch_size=cfg.batch_size, shuffle=False
            )
            model = ACPSTGAT(cfg).to(DEVICE)
            optimizer = torch.optim.AdamW(
                model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay
            )
            best, best_state, wait, history = float("inf"), None, 0, []
            for epoch in range(1, cfg.epochs + 1):
                model.train()
                losses = []
                for past, future in train_loader:
                    optimizer.zero_grad(set_to_none=True)
                    loss = motion_loss(model(past.to(DEVICE)), future.to(DEVICE))
                    loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    optimizer.step()
                    losses.append(loss.item())
                score = validation_mpjpe(model, val_loader)
                history.append({"epoch": epoch, "train_loss": np.mean(losses), "val_mpjpe": score})
                if score < best:
                    best, wait = score, 0
                    best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                else:
                    wait += 1
                print(f"seed={seed} epoch={epoch:03d} loss={np.mean(losses):.6f} val={score:.6f}")
                if wait >= cfg.patience:
                    break
            model.load_state_dict(best_state)
            return model, pd.DataFrame(history)
        """
    ),
    md(
        """
        ## 8. Metrics, baselines, and robustness

        Primary metric: normalized MPJPE (mean Euclidean landmark error).
        Secondary metrics: ADE, FDE, per-horizon error, per-joint error, bone-length
        error, and latency. Last-pose and constant-velocity forecasts show whether
        the learned model improves on trivial motion continuation.
        """
    ),
    code(
        """
        def last_pose_baseline(past, horizon):
            return np.repeat(past[:, -1:, :, :], horizon, axis=1)

        def constant_velocity_baseline(past, horizon):
            velocity = past[:, -1] - past[:, -2]
            steps = np.arange(1, horizon + 1, dtype=np.float32)[None, :, None, None]
            return past[:, -1:, :, :] + steps * velocity[:, None]

        def prediction_metrics(prediction, target):
            distance = np.linalg.norm(prediction - target, axis=-1)
            pred_bones = np.linalg.norm(
                prediction[..., BONES[:,0], :] - prediction[..., BONES[:,1], :], axis=-1
            )
            true_bones = np.linalg.norm(
                target[..., BONES[:,0], :] - target[..., BONES[:,1], :], axis=-1
            )
            return {
                "normalized_mpjpe": float(distance.mean()),
                "ade": float(distance.mean()),
                "fde": float(distance[:, -1].mean()),
                "bone_length_mae": float(np.abs(pred_bones - true_bones).mean()),
                "per_horizon": distance.mean(axis=(0,2)).tolist(),
                "per_joint": distance.mean(axis=(0,1)).tolist(),
            }

        @torch.no_grad()
        def predict_numpy(model, past, batch_size):
            model.eval()
            outputs = []
            for start in range(0, len(past), batch_size):
                batch = torch.as_tensor(past[start:start+batch_size], dtype=torch.float32, device=DEVICE)
                outputs.append(model(batch).cpu().numpy())
            return np.concatenate(outputs)

        def corrupt_inputs(past, noise_std=0.0, missing_probability=0.0, seed=0):
            rng = np.random.default_rng(seed)
            corrupted = past.copy()
            if noise_std:
                corrupted += rng.normal(0, noise_std, corrupted.shape).astype(np.float32)
            if missing_probability:
                mask = rng.random(corrupted.shape[:-1]) < missing_probability
                # Last-observation carry is an explicit deployment-style fallback.
                for t in range(1, corrupted.shape[1]):
                    corrupted[:, t][mask[:, t]] = corrupted[:, t-1][mask[:, t]]
            return corrupted
        """
    ),
    md(
        """
        ## 9. Repeated experiment

        This is the long-running cell. It trains all declared seeds, saves every
        run, then reports mean ± standard deviation. Test results are not used to
        choose the winning seed; all seeds are retained.
        """
    ),
    code(
        """
        train_x, train_y, _ = split_data["train"]
        val_x, val_y, _ = split_data["validation"]
        test_x, test_y, test_rows = split_data["test"]

        all_metrics, trained_models, validation_scores = [], {}, {}
        for seed in CFG.seeds:
            model, history = train_one_seed(seed, (train_x, train_y), (val_x, val_y), CFG)
            prediction = predict_numpy(model, test_x, CFG.batch_size)
            metrics = prediction_metrics(prediction, test_y)
            metrics.update({"seed": seed, "method": "ACP-STGAT"})
            all_metrics.append(metrics)
            trained_models[seed] = model.cpu()
            validation_scores[seed] = float(history["val_mpjpe"].min())
            history.to_csv(RUN_DIR / f"training_history_seed_{seed}.csv", index=False)
            torch.save(model.state_dict(), RUN_DIR / f"checkpoint_seed_{seed}.pt")

        for method, prediction in {
            "last_pose": last_pose_baseline(test_x, CFG.horizon),
            "constant_velocity": constant_velocity_baseline(test_x, CFG.horizon),
        }.items():
            metrics = prediction_metrics(prediction, test_y)
            metrics.update({"seed": None, "method": method})
            all_metrics.append(metrics)

        scalar_columns = ["normalized_mpjpe", "ade", "fde", "bone_length_mae"]
        metric_table = pd.DataFrame([
            {key: value for key, value in row.items() if key not in ("per_horizon", "per_joint")}
            for row in all_metrics
        ])
        display(metric_table)
        summary = metric_table[metric_table.method == "ACP-STGAT"][scalar_columns].agg(["mean", "std"])
        display(summary)
        metric_table.to_csv(RUN_DIR / "metrics_by_run.csv", index=False)
        summary.to_csv(RUN_DIR / "metrics_summary.csv")

        with open(RUN_DIR / "metrics_complete.json", "w") as handle:
            json.dump(all_metrics, handle, indent=2)
        test_rows.to_csv(RUN_DIR / "test_windows.csv", index=False)
        """
    ),
    code(
        """
        # Select the deployment checkpoint using validation only, never test scores.
        best_seed = min(validation_scores, key=validation_scores.get)
        final_model = trained_models[best_seed].to(DEVICE)

        robustness_rows = []
        for noise_std, missing_probability in [(0,0), (0.005,0), (0.01,0), (0,0.05), (0,0.10)]:
            corrupted = corrupt_inputs(test_x, noise_std, missing_probability, seed=2026)
            measured = prediction_metrics(
                predict_numpy(final_model, corrupted, CFG.batch_size), test_y
            )
            robustness_rows.append({
                "noise_std": noise_std,
                "missing_probability": missing_probability,
                **{key: measured[key] for key in ("normalized_mpjpe", "fde")}
            })
        robustness = pd.DataFrame(robustness_rows)
        display(robustness)
        robustness.to_csv(RUN_DIR / "robustness.csv", index=False)

        horizon = np.arange(1, CFG.horizon + 1)
        plt.figure(figsize=(8,4))
        for row in all_metrics:
            if row["method"] != "ACP-STGAT" or row["seed"] == best_seed:
                plt.plot(horizon, row["per_horizon"], label=row["method"])
        plt.xlabel("Forecast frame"); plt.ylabel("Normalized Euclidean error")
        plt.title("Held-out error by forecast horizon"); plt.legend(); plt.tight_layout()
        plt.savefig(RUN_DIR / "error_by_horizon.png", dpi=200)
        plt.show()
        """
    ),
    md(
        """
        ## 10. ONNX parity and latency

        Parity is checked on a real held-out batch. Latency here is Python
        ONNX Runtime CPU latency; browser latency must also be measured inside the
        deployed application because the runtime and hardware differ.
        """
    ),
    code(
        """
        import onnx
        import onnxruntime as ort

        onnx_path = RUN_DIR / f"acp_stgat_{CFG.joints}joint_motion_predictor.onnx"
        final_model = final_model.cpu().eval()
        example = torch.as_tensor(test_x[:1], dtype=torch.float32)
        torch.onnx.export(
            final_model, example, onnx_path,
            input_names=["past"], output_names=["future"],
            dynamic_axes={"past": {0: "batch"}, "future": {0: "batch"}},
            opset_version=17,
        )
        onnx.checker.check_model(onnx.load(onnx_path))
        session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        reference = final_model(example).detach().numpy()
        deployed = session.run(None, {"past": example.numpy()})[0]
        parity = {
            "max_abs_error": float(np.max(np.abs(reference - deployed))),
            "mean_abs_error": float(np.mean(np.abs(reference - deployed))),
            "passed_at_1e-4": bool(np.max(np.abs(reference - deployed)) < 1e-4),
        }
        latencies = []
        for sample in test_x[:min(100, len(test_x))]:
            start = time.perf_counter()
            session.run(None, {"past": sample[None].astype(np.float32)})
            latencies.append((time.perf_counter() - start) * 1000)
        parity.update({
            "cpu_latency_median_ms": float(np.median(latencies)),
            "cpu_latency_p95_ms": float(np.percentile(latencies, 95)),
            "onnx_sha256": sha256_file(onnx_path),
        })
        print(parity)
        with open(RUN_DIR / "onnx_parity_latency.json", "w") as handle:
            json.dump(parity, handle, indent=2)
        """
    ),
    md(
        """
        ## 11. Freeze provenance and download

        Before thesis reporting, inspect failures visually, add public-dataset
        licenses/own-recording consent references to the manifest, and run browser
        parity on the exact exported ONNX file.
        """
    ),
    md(
        """
        ## Expected evidence after execution

        A defensible completed run contains:

        - exact participant/session split and dataset SHA-256
        - three ACP-STGAT seed results with mean and standard deviation
        - last-pose and constant-velocity baseline results
        - normalized MPJPE, ADE, FDE and bone-length error
        - error-by-horizon plot and robustness table
        - checkpoints and the exported ONNX model
        - real-batch ONNX parity plus median/p95 CPU latency
        - provenance JSON and the executed notebook

        There is intentionally no “expected accuracy percentage.” Motion
        forecasting is coordinate regression, and its values must be measured
        from the held-out dataset rather than estimated in advance.
        """
    ),
    code(
        """
        provenance = {
            "run_id": RUN_ID,
            "data_mode": DATA_MODE,
            "skeleton_variant": f"{CFG.joints}-joint",
            "configuration": asdict(CFG),
            "dataset_sha256": sha256_file(CFG.data_path),
            "group_level": GROUP_LEVEL,
            "split_indices": {k: v.tolist() for k, v in split_indices.items()},
            "versions": {
                "python": platform.python_version(),
                "torch": torch.__version__,
                "numpy": np.__version__,
                "sklearn": sklearn.__version__,
                "onnxruntime": ort.__version__,
            },
            "device": str(DEVICE),
            "limitations": [
                "Normalized coordinates are not physical millimetres.",
                "Best-seed visualization is descriptive; aggregate metrics use every seed.",
                "Browser runtime latency requires separate in-system measurement.",
                (
                    "Human3.6M 17-joint benchmark results are not direct accuracy "
                    "evidence for the deployed MediaPipe-33 model."
                    if DATA_MODE == "h36m17_public_benchmark"
                    else "MediaPipe observations are not motion-capture ground truth."
                )
            ],
        }
        with open(RUN_DIR / "provenance.json", "w") as handle:
            json.dump(provenance, handle, indent=2)

        import shutil
        archive = shutil.make_archive(str(RUN_DIR), "zip", RUN_DIR)
        print("Archive:", archive)
        from google.colab import files
        files.download(archive)
        """
    ),
]


PHASE_CELLS = [
    md(
        """
        # Temporal phase-classification model — research evaluation

        This notebook trains and evaluates a configurable martial-arts temporal
        phase classifier. The jab is the current representative evaluation
        technique, not the definition or limit of the framework.

        It uses human-verified session annotations for validation/test, splits
        groups before windowing, compares non-learned baselines, reports frame and
        boundary metrics, and checks ONNX deployment parity.
        """
    ),
    code(
        """
        !pip -q install onnx onnxruntime scikit-learn pandas seaborn
        """
    ),
    code(
        """
        import hashlib, json, os, platform, random, time
        from dataclasses import asdict, dataclass
        from datetime import datetime, timezone
        from pathlib import Path

        import matplotlib.pyplot as plt
        import numpy as np
        import pandas as pd
        import seaborn as sns
        import sklearn
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        from sklearn.metrics import (
            accuracy_score, balanced_accuracy_score, classification_report,
            confusion_matrix, f1_score
        )
        from sklearn.model_selection import GroupShuffleSplit
        from torch.utils.data import DataLoader, Dataset

        DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print("Device:", DEVICE, "PyTorch:", torch.__version__)
        """
    ),
    md(
        """
        ## 1. Configuration and phase vocabulary

        Adjust the phase list only before annotation/training. The labels below are
        a framework vocabulary; a technique-specific mapping may use a subset.
        """
    ),
    code(
        """
        @dataclass
        class Config:
            data_path: str = "/content/phase_sessions.json"
            output_root: str = "/content/research_outputs/phase_classifier"
            technique_id: str = "jab"
            window: int = 90
            stride: int = 15
            joints: int = 33
            features: int = 4
            batch_size: int = 32
            epochs: int = 60
            patience: int = 10
            learning_rate: float = 3e-4
            weight_decay: float = 1e-4
            hidden_dim: int = 96
            dropout: float = 0.15
            test_fraction: float = 0.20
            validation_fraction_of_remaining: float = 0.25
            seeds: tuple = (42, 43, 44)
            boundary_tolerance_frames: int = 5

        CFG = Config()
        PHASES = [
            "__PAD__", "__UNKNOWN__", "__TRACKING_LOST__",
            "PREPARATION", "ENTRY", "EXECUTION", "PEAK",
            "RETRACTION", "RECOVERY"
        ]
        PHASE_TO_ID = {name: index for index, name in enumerate(PHASES)}
        RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        RUN_DIR = Path(CFG.output_root) / RUN_ID
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        print(asdict(CFG), PHASE_TO_ID)
        """
    ),
    md(
        """
        ## 2. Strict session loader and normalization

        Expected JSON is documented in `research/data/README.md`. Validation and
        test sessions must have `annotation_status = human_verified`. Synthetic
        data, if included, is restricted to training and remains explicitly marked.
        """
    ),
    code(
        """
        def sha256_file(path, block_size=1 << 20):
            digest = hashlib.sha256()
            with open(path, "rb") as handle:
                for block in iter(lambda: handle.read(block_size), b""):
                    digest.update(block)
            return digest.hexdigest()

        def normalize_landmarks(values):
            values = np.asarray(values, dtype=np.float32)
            if values.shape != (33, 4):
                raise ValueError(f"Expected [33,4], received {values.shape}")
            xyz, visibility = values[:, :3].copy(), values[:, 3:4].copy()
            center = (xyz[23] + xyz[24]) / 2
            shoulder_width = np.linalg.norm(xyz[11] - xyz[12])
            scale = max(float(shoulder_width), 1e-6)
            xyz = (xyz - center) / scale
            return np.concatenate((xyz, np.clip(visibility, 0, 1)), axis=-1)

        def labels_from_segments(frame_count, segments):
            labels = np.full(frame_count, PHASE_TO_ID["__UNKNOWN__"], dtype=np.int64)
            for segment in segments:
                phase = str(segment["phase"]).upper()
                if phase not in PHASE_TO_ID:
                    raise ValueError(f"Unknown phase: {phase}")
                start, end = int(segment["start_frame"]), int(segment["end_frame"])
                if not (0 <= start < end <= frame_count):
                    raise ValueError(f"Invalid segment [{start},{end})")
                labels[start:end] = PHASE_TO_ID[phase]
            return labels

        def load_sessions(path, technique_id):
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
            records = payload["sessions"] if isinstance(payload, dict) else payload
            sessions = []
            for record in records:
                if record.get("technique_id") != technique_id:
                    continue
                frames = record["frames"]
                landmarks = np.stack([normalize_landmarks(frame["landmarks"]) for frame in frames])
                labels = labels_from_segments(len(frames), record["segments"])
                sessions.append({
                    "session_id": str(record["session_id"]),
                    "participant_id": str(record["participant_id"]),
                    "fps": float(record.get("fps", 30)),
                    "annotation_status": str(record.get("annotation_status", "unverified")),
                    "source_type": str(record.get("source_type", "real")),
                    "x": landmarks,
                    "y": labels,
                })
            if not sessions:
                raise ValueError(f"No sessions found for technique_id={technique_id!r}")
            return sessions

        sessions = load_sessions(CFG.data_path, CFG.technique_id)
        print("Sessions:", len(sessions), "Participants:", len({s["participant_id"] for s in sessions}))
        print("Dataset SHA-256:", sha256_file(CFG.data_path))
        """
    ),
    md(
        """
        ## 3. Grouped split before windowing

        Real sessions are split first. Synthetic sessions can augment only the
        training split. Windows inherit their session split, preventing overlap
        leakage.
        """
    ),
    code(
        """
        def split_real_sessions(sessions, cfg, seed):
            real_indices = np.array([
                i for i, session in enumerate(sessions) if session["source_type"] != "synthetic"
            ])
            participants = np.array([sessions[i]["participant_id"] for i in real_indices])
            session_ids = np.array([sessions[i]["session_id"] for i in real_indices])
            groups = participants if len(np.unique(participants)) >= 3 else session_ids
            group_level = "participant" if groups is participants else "session"
            outer = GroupShuffleSplit(n_splits=1, test_size=cfg.test_fraction, random_state=seed)
            train_val_rel, test_rel = next(outer.split(real_indices, groups=groups))
            train_val = real_indices[train_val_rel]
            test = real_indices[test_rel]
            inner_groups = groups[train_val_rel]
            inner = GroupShuffleSplit(
                n_splits=1, test_size=cfg.validation_fraction_of_remaining,
                random_state=seed + 1
            )
            train_rel, val_rel = next(inner.split(train_val, groups=inner_groups))
            train, val = train_val[train_rel], train_val[val_rel]
            synthetic = np.array([
                i for i, session in enumerate(sessions) if session["source_type"] == "synthetic"
            ], dtype=int)
            train = np.concatenate((train, synthetic))
            for index in np.concatenate((val, test)):
                if sessions[index]["annotation_status"] != "human_verified":
                    raise ValueError("Validation/test sessions must be human_verified.")
            return {"train": train, "validation": val, "test": test}, group_level

        def create_windows(indices, sessions, cfg):
            xs, ys, rows = [], [], []
            for session_index in indices:
                session = sessions[session_index]
                if len(session["x"]) < cfg.window:
                    continue
                for start in range(0, len(session["x"]) - cfg.window + 1, cfg.stride):
                    end = start + cfg.window
                    xs.append(session["x"][start:end])
                    ys.append(session["y"][start:end])
                    rows.append({
                        "session_index": int(session_index),
                        "session_id": session["session_id"],
                        "participant_id": session["participant_id"],
                        "start_frame": start,
                        "fps": session["fps"],
                        "source_type": session["source_type"],
                    })
            if not xs:
                raise ValueError("A split produced no windows.")
            return np.stack(xs), np.stack(ys), pd.DataFrame(rows)

        split_indices, GROUP_LEVEL = split_real_sessions(sessions, CFG, CFG.seeds[0])
        split_data = {
            name: create_windows(indices, sessions, CFG)
            for name, indices in split_indices.items()
        }
        for name, (x, y, rows) in split_data.items():
            print(name, x.shape, "sessions:", rows.session_id.nunique())
        """
    ),
    md(
        """
        ## 4. Spatial-graph and temporal-convolution classifier

        The model produces one phase label per input frame. Its graph mixing is
        based on MediaPipe adjacency and its temporal layers use dilated
        convolutions. This notebook calls it a temporal phase classifier; it does
        not claim universal technique coverage.
        """
    ),
    code(
        """
        EDGES = [
            (0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),(9,10),
            (11,12),(11,13),(13,15),(15,17),(15,19),(15,21),(17,19),
            (12,14),(14,16),(16,18),(16,20),(16,22),(18,20),
            (11,23),(12,24),(23,24),(23,25),(25,27),(27,29),(29,31),
            (27,31),(24,26),(26,28),(28,30),(30,32),(28,32)
        ]

        def normalized_adjacency(joints=33):
            adjacency = torch.eye(joints)
            for a, b in EDGES:
                adjacency[a,b] = adjacency[b,a] = 1
            degree = adjacency.sum(1).clamp_min(1)
            inv_sqrt = degree.pow(-0.5)
            return inv_sqrt[:,None] * adjacency * inv_sqrt[None,:]

        class PhaseDataset(Dataset):
            def __init__(self, x, y):
                self.x = torch.as_tensor(x, dtype=torch.float32)
                self.y = torch.as_tensor(y, dtype=torch.long)
            def __len__(self):
                return len(self.x)
            def __getitem__(self, index):
                return self.x[index], self.y[index]

        class SpatialGraphBlock(nn.Module):
            def __init__(self, input_dim, output_dim, dropout):
                super().__init__()
                self.self_projection = nn.Linear(input_dim, output_dim)
                self.neighbor_projection = nn.Linear(input_dim, output_dim)
                self.norm = nn.LayerNorm(output_dim)
                self.dropout = nn.Dropout(dropout)
                self.register_buffer("adjacency", normalized_adjacency())
            def forward(self, x):
                neighbors = torch.einsum("jk,btkd->btjd", self.adjacency, x)
                return self.norm(F.gelu(
                    self.self_projection(x) + self.neighbor_projection(neighbors)
                ))

        class TemporalResidualBlock(nn.Module):
            def __init__(self, channels, dilation, dropout):
                super().__init__()
                padding = dilation
                self.conv = nn.Conv1d(
                    channels, channels, kernel_size=3,
                    padding=padding, dilation=dilation
                )
                self.norm = nn.BatchNorm1d(channels)
                self.dropout = nn.Dropout(dropout)
            def forward(self, x):
                return x + self.dropout(F.gelu(self.norm(self.conv(x))))

        class TemporalPhaseClassifier(nn.Module):
            def __init__(self, cfg, class_count):
                super().__init__()
                self.spatial1 = SpatialGraphBlock(cfg.features, cfg.hidden_dim, cfg.dropout)
                self.spatial2 = SpatialGraphBlock(cfg.hidden_dim, cfg.hidden_dim, cfg.dropout)
                self.temporal = nn.Sequential(*[
                    TemporalResidualBlock(cfg.hidden_dim, dilation, cfg.dropout)
                    for dilation in (1, 2, 4, 8)
                ])
                self.classifier = nn.Conv1d(cfg.hidden_dim, class_count, 1)
            def forward(self, x):
                x = self.spatial2(self.spatial1(x)).mean(dim=2)
                return self.classifier(self.temporal(x.transpose(1,2))).transpose(1,2)
        """
    ),
    md(
        """
        ## 5. Weighted training and early stopping

        Class weights are calculated from training frames only. Validation macro
        F1 selects the checkpoint; test labels remain unused during training.
        """
    ),
    code(
        """
        def class_weights(labels, class_count):
            counts = np.bincount(labels.reshape(-1), minlength=class_count).astype(float)
            weights = counts.sum() / np.maximum(counts, 1)
            weights = weights / weights.mean()
            return torch.as_tensor(weights, dtype=torch.float32)

        @torch.no_grad()
        def collect_predictions(model, loader):
            model.eval()
            true, predicted, probabilities = [], [], []
            for x, y in loader:
                logits = model(x.to(DEVICE))
                probabilities.append(torch.softmax(logits, -1).cpu().numpy())
                predicted.append(logits.argmax(-1).cpu().numpy())
                true.append(y.numpy())
            return np.concatenate(true), np.concatenate(predicted), np.concatenate(probabilities)

        def seed_everything(seed):
            random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

        def train_one_seed(seed, train_arrays, val_arrays, cfg):
            seed_everything(seed)
            train_loader = DataLoader(
                PhaseDataset(*train_arrays), batch_size=cfg.batch_size, shuffle=True,
                generator=torch.Generator().manual_seed(seed)
            )
            val_loader = DataLoader(
                PhaseDataset(*val_arrays), batch_size=cfg.batch_size, shuffle=False
            )
            model = TemporalPhaseClassifier(cfg, len(PHASES)).to(DEVICE)
            optimizer = torch.optim.AdamW(
                model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay
            )
            weights = class_weights(train_arrays[1], len(PHASES)).to(DEVICE)
            best, state, wait, history = -1.0, None, 0, []
            for epoch in range(1, cfg.epochs + 1):
                model.train(); losses = []
                for x, y in train_loader:
                    optimizer.zero_grad(set_to_none=True)
                    logits = model(x.to(DEVICE))
                    loss = F.cross_entropy(
                        logits.reshape(-1, len(PHASES)), y.to(DEVICE).reshape(-1),
                        weight=weights
                    )
                    loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    optimizer.step(); losses.append(loss.item())
                true, predicted, _ = collect_predictions(model, val_loader)
                score = f1_score(true.ravel(), predicted.ravel(), average="macro", zero_division=0)
                history.append({"epoch": epoch, "train_loss": np.mean(losses), "val_macro_f1": score})
                print(f"seed={seed} epoch={epoch:03d} loss={np.mean(losses):.5f} val_f1={score:.5f}")
                if score > best:
                    best, wait = score, 0
                    state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                else:
                    wait += 1
                if wait >= cfg.patience:
                    break
            model.load_state_dict(state)
            return model, pd.DataFrame(history)
        """
    ),
    md(
        """
        ## 6. Frame metrics and transition-boundary metrics

        Accuracy alone can hide poor minority-phase behavior, so macro F1,
        balanced accuracy, per-class scores, and confusion matrices are required.
        Boundary matching reports precision/recall and frame timing error within a
        declared tolerance.
        """
    ),
    code(
        """
        def frame_metrics(true, predicted):
            true, predicted = true.ravel(), predicted.ravel()
            return {
                "accuracy": float(accuracy_score(true, predicted)),
                "balanced_accuracy": float(balanced_accuracy_score(true, predicted)),
                "macro_f1": float(f1_score(true, predicted, average="macro", zero_division=0)),
                "weighted_f1": float(f1_score(true, predicted, average="weighted", zero_division=0)),
                "report": classification_report(
                    true, predicted, labels=np.arange(len(PHASES)),
                    target_names=PHASES, output_dict=True, zero_division=0
                ),
                "confusion_matrix": confusion_matrix(
                    true, predicted, labels=np.arange(len(PHASES))
                ).tolist(),
            }

        def transition_indices(labels):
            return np.flatnonzero(labels[1:] != labels[:-1]) + 1

        def boundary_metrics(true, predicted, tolerance):
            errors, matched_pred = [], set()
            true_boundaries, pred_boundaries = transition_indices(true), transition_indices(predicted)
            for boundary in true_boundaries:
                candidates = [
                    (abs(int(other) - int(boundary)), index)
                    for index, other in enumerate(pred_boundaries)
                    if index not in matched_pred and abs(int(other) - int(boundary)) <= tolerance
                ]
                if candidates:
                    error, index = min(candidates)
                    errors.append(error); matched_pred.add(index)
            matches = len(errors)
            return {
                "boundary_precision": matches / max(len(pred_boundaries), 1),
                "boundary_recall": matches / max(len(true_boundaries), 1),
                "boundary_mae_frames": float(np.mean(errors)) if errors else None,
                "true_boundary_count": int(len(true_boundaries)),
                "predicted_boundary_count": int(len(pred_boundaries)),
            }

        def majority_baseline(train_y, shape):
            majority = int(np.bincount(train_y.ravel(), minlength=len(PHASES)).argmax())
            return np.full(shape, majority, dtype=np.int64)
        """
    ),
    md(
        """
        ## 7. Repeated held-out evaluation

        Window-level frame scores are supplemented with per-window boundary
        results. For the final thesis, reconstruct full session timelines (average
        overlapping probabilities) and have the deployed repetition decoder scored
        against repetition annotations in `pilot-study/phase_annotations`.
        """
    ),
    code(
        """
        train_x, train_y, _ = split_data["train"]
        val_x, val_y, _ = split_data["validation"]
        test_x, test_y, test_rows = split_data["test"]
        test_loader = DataLoader(PhaseDataset(test_x, test_y), batch_size=CFG.batch_size)

        results, trained_models, validation_scores = [], {}, {}
        for seed in CFG.seeds:
            model, history = train_one_seed(seed, (train_x, train_y), (val_x, val_y), CFG)
            true, predicted, probabilities = collect_predictions(model, test_loader)
            measured = frame_metrics(true, predicted)
            boundaries = [
                boundary_metrics(t, p, CFG.boundary_tolerance_frames)
                for t, p in zip(true, predicted)
            ]
            scalar = {key: measured[key] for key in ("accuracy", "balanced_accuracy", "macro_f1", "weighted_f1")}
            scalar.update({
                "boundary_precision": float(np.mean([x["boundary_precision"] for x in boundaries])),
                "boundary_recall": float(np.mean([x["boundary_recall"] for x in boundaries])),
                "boundary_mae_frames": float(np.nanmean([
                    np.nan if x["boundary_mae_frames"] is None else x["boundary_mae_frames"]
                    for x in boundaries
                ])),
                "seed": seed, "method": "temporal_phase_classifier"
            })
            results.append(scalar)
            trained_models[seed] = model.cpu()
            validation_scores[seed] = float(history["val_macro_f1"].max())
            history.to_csv(RUN_DIR / f"training_history_seed_{seed}.csv", index=False)
            torch.save(model.state_dict(), RUN_DIR / f"checkpoint_seed_{seed}.pt")
            with open(RUN_DIR / f"test_report_seed_{seed}.json", "w") as handle:
                json.dump(measured, handle, indent=2)

        baseline = majority_baseline(train_y, test_y.shape)
        baseline_metrics = frame_metrics(test_y, baseline)
        results.append({
            **{key: baseline_metrics[key] for key in ("accuracy", "balanced_accuracy", "macro_f1", "weighted_f1")},
            "boundary_precision": 0.0, "boundary_recall": 0.0,
            "boundary_mae_frames": np.nan, "seed": None, "method": "majority"
        })
        result_table = pd.DataFrame(results)
        display(result_table)
        result_table.to_csv(RUN_DIR / "metrics_by_run.csv", index=False)
        summary = result_table[result_table.method == "temporal_phase_classifier"].select_dtypes("number").agg(["mean","std"])
        display(summary)
        summary.to_csv(RUN_DIR / "metrics_summary.csv")
        test_rows.to_csv(RUN_DIR / "test_windows.csv", index=False)
        """
    ),
    code(
        """
        # Select the deployment checkpoint using validation only, never test scores.
        best_seed = max(validation_scores, key=validation_scores.get)
        final_model = trained_models[best_seed].to(DEVICE)
        true, predicted, _ = collect_predictions(final_model, test_loader)
        matrix = confusion_matrix(true.ravel(), predicted.ravel(), labels=np.arange(len(PHASES)))
        plt.figure(figsize=(10,8))
        sns.heatmap(matrix, annot=True, fmt="d", xticklabels=PHASES, yticklabels=PHASES, cmap="Blues")
        plt.xlabel("Predicted"); plt.ylabel("True"); plt.title("Held-out phase confusion matrix")
        plt.tight_layout(); plt.savefig(RUN_DIR / "confusion_matrix.png", dpi=200); plt.show()
        """
    ),
    md(
        """
        ## 8. ONNX parity and CPU latency

        The exact ONNX file exported here must be used for browser evaluation.
        Measure browser median/p95 latency separately on the research laptop.
        """
    ),
    code(
        """
        import onnx
        import onnxruntime as ort

        onnx_path = RUN_DIR / "temporal_phase_classifier.onnx"
        final_model = final_model.cpu().eval()
        example = torch.as_tensor(test_x[:1], dtype=torch.float32)
        torch.onnx.export(
            final_model, example, onnx_path,
            input_names=["landmarks"], output_names=["phase_logits"],
            dynamic_axes={"landmarks": {0: "batch"}, "phase_logits": {0: "batch"}},
            opset_version=17
        )
        onnx.checker.check_model(onnx.load(onnx_path))
        runtime = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        reference = final_model(example).detach().numpy()
        deployed = runtime.run(None, {"landmarks": example.numpy()})[0]
        max_error = float(np.max(np.abs(reference - deployed)))
        labels_equal = bool(np.array_equal(reference.argmax(-1), deployed.argmax(-1)))
        latencies = []
        for sample in test_x[:min(100, len(test_x))]:
            start = time.perf_counter()
            runtime.run(None, {"landmarks": sample[None].astype(np.float32)})
            latencies.append((time.perf_counter() - start) * 1000)
        parity = {
            "max_abs_logit_error": max_error,
            "predicted_labels_equal": labels_equal,
            "passed_at_1e-4": bool(max_error < 1e-4 and labels_equal),
            "cpu_latency_median_ms": float(np.median(latencies)),
            "cpu_latency_p95_ms": float(np.percentile(latencies, 95)),
            "onnx_sha256": sha256_file(onnx_path),
        }
        print(parity)
        with open(RUN_DIR / "onnx_parity_latency.json", "w") as handle:
            json.dump(parity, handle, indent=2)
        """
    ),
    md(
        """
        ## 9. Metadata, provenance, and archive

        The metadata records evaluation origin explicitly so synthetic pipeline
        checks cannot later be confused with human-verified test performance.
        """
    ),
    code(
        """
        metadata = {
            "model_type": "temporal-phase-classifier",
            "technique_id": CFG.technique_id,
            "input": {
                "frames": CFG.window, "landmarks": CFG.joints,
                "features": ["x", "y", "z", "visibility"]
            },
            "phase_labels": PHASES,
            "evaluation_origin": "human_verified_grouped_test_split",
            "run_id": RUN_ID,
            "group_level": GROUP_LEVEL,
            "dataset_sha256": sha256_file(CFG.data_path),
            "onnx_sha256": sha256_file(onnx_path),
            "configuration": asdict(CFG),
            "split_indices": {key: value.tolist() for key, value in split_indices.items()},
            "versions": {
                "python": platform.python_version(),
                "torch": torch.__version__,
                "numpy": np.__version__,
                "sklearn": sklearn.__version__,
                "onnxruntime": ort.__version__,
            },
            "limitations": [
                "Coverage is limited to documented techniques and participants.",
                "Three-participant system study is a feasibility pilot.",
                "Repetition decoding must be evaluated in the deployed system."
            ],
        }
        with open(RUN_DIR / "model_metadata.json", "w") as handle:
            json.dump(metadata, handle, indent=2)

        import shutil
        archive = shutil.make_archive(str(RUN_DIR), "zip", RUN_DIR)
        print("Archive:", archive)
        from google.colab import files
        files.download(archive)
        """
    ),
]


def write_notebook(name: str, cells: list[dict]) -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    target = NOTEBOOK_DIR / name
    target.write_text(json.dumps(notebook(cells), indent=1), encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    write_notebook("ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb", MOTION_CELLS)
