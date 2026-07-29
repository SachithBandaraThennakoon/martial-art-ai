"""Build a leakage-safe temporal phase dataset from exported Practice tapes.

Usage in Colab or locally:
  python prepare_dataset.py \
    --input-dir /content/tapes \
    --output /content/jab_temporal_dataset.npz \
    --technique jab \
    --states /content/extracted-technique-states.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

PAD = "__PAD__"
UNKNOWN = "__UNKNOWN__"
TRACKING_LOST = "__TRACKING_LOST__"
JOINT_COUNT = 33
CHANNEL_COUNT = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--technique", required=True)
    parser.add_argument("--states", type=Path, required=True)
    parser.add_argument("--sequence-length", type=int, default=90)
    parser.add_argument("--stride", type=int, default=15)
    parser.add_argument("--minimum-labelled-ratio", type=float, default=0.65)
    parser.add_argument(
        "--include-synthetic",
        action="store_true",
        help="Include explicitly marked bootstrap synthetic sessions.",
    )
    return parser.parse_args()


def load_state_names(path: Path) -> list[str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    order = document.get("state_order") or list(document.get("states", {}))
    if not order:
        raise ValueError(f"No state definitions found in {path}")
    return [PAD, UNKNOWN, TRACKING_LOST, *order]


def restore_landmarks(values: Any) -> np.ndarray:
    result = np.zeros((JOINT_COUNT, CHANNEL_COUNT), dtype=np.float32)
    if not isinstance(values, list):
        return result
    for index, point in enumerate(values[:JOINT_COUNT]):
        if not isinstance(point, list):
            continue
        for channel in range(min(CHANNEL_COUNT, len(point))):
            value = point[channel]
            if isinstance(value, (int, float)):
                result[index, channel] = float(value) / 10000.0
    return result


def select_landmarks(frame: dict[str, Any]) -> np.ndarray:
    for key in ("wp", "op", "p"):
        values = frame.get(key)
        if isinstance(values, list) and values:
            return restore_landmarks(values)
    return np.zeros((JOINT_COUNT, CHANNEL_COUNT), dtype=np.float32)


def normalize_pose(pose: np.ndarray) -> np.ndarray:
    normalized = pose.copy()
    left_hip, right_hip = normalized[23, :3], normalized[24, :3]
    left_shoulder, right_shoulder = normalized[11, :3], normalized[12, :3]
    root = (left_hip + right_hip) / 2.0
    shoulder_width = np.linalg.norm(left_shoulder - right_shoulder)
    torso_height = np.linalg.norm(
        ((left_shoulder + right_shoulder) / 2.0) - root
    )
    scale = max(float(shoulder_width), float(torso_height), 1e-4)
    normalized[:, :3] = (normalized[:, :3] - root) / scale
    normalized[:, 3] = np.clip(normalized[:, 3], 0.0, 1.0)
    return normalized


def corrected_label(frame: dict[str, Any]) -> str:
    corrected = frame.get("rc") or {}
    if corrected.get("tl") is True:
        return TRACKING_LOST
    if corrected.get("u") is True:
        return UNKNOWN
    state = corrected.get("s")
    return str(state) if state else UNKNOWN


def verified_manual_labels(
    document: dict[str, Any], frame_count: int, include_synthetic: bool
) -> list[str] | None:
    annotation = document.get("manual_annotation") or {}
    accepted = {"human_verified"}
    if include_synthetic:
        accepted.add("synthetic_verified")
    if annotation.get("status") not in accepted:
        return None
    labels = [PAD] * frame_count
    for segment in annotation.get("segments") or []:
        start = int(segment.get("start_frame", -1))
        end = int(segment.get("end_frame", -1))
        state = str(segment.get("state") or "").strip().upper()
        if start < 0 or end < start or end >= frame_count or not state:
            return None
        for index in range(start, end + 1):
            if labels[index] != PAD:
                return None
            labels[index] = state
    return labels if labels and all(label != PAD for label in labels) else None


def tape_matches_technique(document: dict[str, Any], technique: str) -> bool:
    metadata = document.get("metadata") or {}
    name = (
        document.get("technique_id")
        or document.get("technique_name")
        or metadata.get("techniqueId")
        or metadata.get("technique_id")
        or metadata.get("techniqueName")
        or metadata.get("technique_name")
        or ""
    )
    normalized = str(name).strip().lower().replace(" ", "-")
    return not normalized or normalized == technique.lower()


def windows_for_session(
    document: dict[str, Any],
    label_to_id: dict[str, int],
    sequence_length: int,
    stride: int,
    minimum_labelled_ratio: float,
    include_synthetic: bool,
) -> tuple[list[np.ndarray], list[np.ndarray], list[np.ndarray]]:
    frames = document.get("frames") or []
    manual_labels = verified_manual_labels(document, len(frames), include_synthetic)
    if manual_labels is None:
        return [], [], []
    features = np.asarray(
        [normalize_pose(select_landmarks(frame)) for frame in frames],
        dtype=np.float32,
    )
    labels = np.asarray(
        [label_to_id.get(label, label_to_id[UNKNOWN]) for label in manual_labels],
        dtype=np.int64,
    )
    labelled = np.ones(len(frames), dtype=np.bool_)
    outputs: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    masks: list[np.ndarray] = []
    if not len(features):
        return outputs, targets, masks

    starts = list(range(0, max(1, len(features) - sequence_length + 1), stride))
    last_start = max(0, len(features) - sequence_length)
    if last_start not in starts:
        starts.append(last_start)

    for start in starts:
        end = min(len(features), start + sequence_length)
        valid_count = end - start
        if valid_count <= 0:
            continue
        if float(labelled[start:end].mean()) < minimum_labelled_ratio:
            continue
        x = np.zeros(
            (sequence_length, JOINT_COUNT, CHANNEL_COUNT), dtype=np.float32
        )
        y = np.full(sequence_length, label_to_id[PAD], dtype=np.int64)
        mask = np.zeros(sequence_length, dtype=np.bool_)
        x[:valid_count] = features[start:end]
        y[:valid_count] = labels[start:end]
        mask[:valid_count] = True
        outputs.append(x)
        targets.append(y)
        masks.append(mask)
    return outputs, targets, masks


def main() -> None:
    args = parse_args()
    if args.sequence_length < 8 or args.stride < 1:
        raise ValueError("sequence length must be >= 8 and stride must be >= 1")
    label_names = load_state_names(args.states)
    label_to_id = {name: index for index, name in enumerate(label_names)}
    feature_windows: list[np.ndarray] = []
    label_windows: list[np.ndarray] = []
    mask_windows: list[np.ndarray] = []
    groups: list[str] = []
    origins: list[str] = []

    paths = sorted(args.input_dir.glob("*.json"))
    for path in paths:
        source = json.loads(path.read_text(encoding="utf-8"))
        documents = source.get("sessions") if isinstance(source, dict) else None
        if not isinstance(documents, list):
            documents = [source]
        for document_index, document in enumerate(documents):
            if not tape_matches_technique(document, args.technique):
                continue
            x, y, masks = windows_for_session(
                document,
                label_to_id,
                args.sequence_length,
                args.stride,
                args.minimum_labelled_ratio,
                args.include_synthetic,
            )
            group = str(
                document.get("session_id")
                or (document.get("metadata") or {}).get("sessionId")
                or f"{path.stem}_{document_index}"
            )
            feature_windows.extend(x)
            label_windows.extend(y)
            mask_windows.extend(masks)
            groups.extend([group] * len(x))
            origin = str(
                (document.get("provenance") or {}).get("origin") or "real"
            )
            origins.extend([origin] * len(x))

    if not feature_windows:
        raise RuntimeError(
            "No human-verified windows were created. Complete manual annotation "
            "and export verified tape bundles from the Temporal Data Lab."
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        features=np.stack(feature_windows),
        labels=np.stack(label_windows),
        mask=np.stack(mask_windows),
        groups=np.asarray(groups),
        origins=np.asarray(origins),
        label_names=np.asarray(label_names),
        technique=np.asarray(args.technique),
        sequence_length=np.asarray(args.sequence_length),
        schema_version=np.asarray("1.0"),
    )
    print(f"Wrote {len(feature_windows)} windows from {len(set(groups))} sessions")
    print(f"Output: {args.output}")
    print(f"Labels: {label_names}")


if __name__ == "__main__":
    main()
