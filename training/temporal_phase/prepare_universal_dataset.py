"""Build one technique-conditioned temporal dataset from verified exports."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import numpy as np

from prepare_dataset import windows_for_session


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--label-config",
        type=Path,
        default=Path(__file__).with_name("universal-labels.json"),
    )
    parser.add_argument("--sequence-length", type=int, default=90)
    parser.add_argument("--stride", type=int, default=15)
    parser.add_argument("--minimum-labelled-ratio", type=float, default=0.65)
    parser.add_argument("--include-synthetic", action="store_true")
    return parser.parse_args()


def technique_id(document: dict) -> str:
    metadata = document.get("metadata") or {}
    value = (
        document.get("technique_id")
        or document.get("technique_name")
        or metadata.get("techniqueId")
        or metadata.get("technique_id")
        or metadata.get("techniqueName")
        or metadata.get("technique_name")
        or ""
    )
    return str(value).strip().lower().replace(" ", "-")


def remap_annotation(document: dict, mapping: dict[str, str]) -> dict:
    remapped = copy.deepcopy(document)
    annotation = remapped.get("manual_annotation") or {}
    for segment in annotation.get("segments") or []:
        native = str(segment.get("state") or "").strip().upper()
        if native in {"__UNKNOWN__", "__TRACKING_LOST__"}:
            continue
        if native not in mapping:
            raise ValueError(f'No universal phase mapping for state "{native}"')
        segment["state"] = mapping[native]
    return remapped


def main() -> None:
    args = parse_args()
    config = json.loads(args.label_config.read_text(encoding="utf-8"))
    phases = config["phases"]
    label_to_id = {name: index for index, name in enumerate(phases)}
    supported = config["techniques"]
    technique_names = list(supported)
    technique_to_id = {name: index for index, name in enumerate(technique_names)}

    features, labels, masks = [], [], []
    groups, origins, technique_ids = [], [], []
    for path in sorted(args.input_dir.rglob("*.json")):
        source = json.loads(path.read_text(encoding="utf-8"))
        documents = source.get("sessions") if isinstance(source, dict) else None
        if not isinstance(documents, list):
            documents = [source]
        for document_index, document in enumerate(documents):
            technique = technique_id(document)
            if technique not in supported:
                continue
            remapped = remap_annotation(
                document, supported[technique]["native_to_phase"]
            )
            x, y, valid = windows_for_session(
                remapped,
                label_to_id,
                args.sequence_length,
                args.stride,
                args.minimum_labelled_ratio,
                args.include_synthetic,
            )
            session = str(
                document.get("session_id")
                or (document.get("metadata") or {}).get("sessionId")
                or f"{path.stem}_{document_index}"
            )
            origin = str(
                (document.get("provenance") or {}).get("origin") or "real"
            )
            features.extend(x)
            labels.extend(y)
            masks.extend(valid)
            groups.extend([f"{technique}:{session}"] * len(x))
            origins.extend([origin] * len(x))
            technique_ids.extend([technique_to_id[technique]] * len(x))

    if not features:
        raise RuntimeError("No verified multi-technique windows were created")
    observed_techniques = {
        technique_names[index] for index in set(technique_ids)
    }
    if len(observed_techniques) < 2:
        raise RuntimeError(
            "Universal training requires verified sessions from at least two "
            "techniques; observed: "
            + ", ".join(sorted(observed_techniques))
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        features=np.stack(features),
        labels=np.stack(labels),
        mask=np.stack(masks),
        groups=np.asarray(groups),
        origins=np.asarray(origins),
        technique_ids=np.asarray(technique_ids, dtype=np.int64),
        technique_names=np.asarray(technique_names),
        label_names=np.asarray(phases),
        sequence_length=np.asarray(args.sequence_length),
        phase_mappings_json=np.asarray(json.dumps(supported)),
        schema_version=np.asarray("2.0"),
    )
    print(
        f"Wrote {len(features)} windows across "
        f"{len(set(groups))} sessions and {len(observed_techniques)} techniques"
    )


if __name__ == "__main__":
    main()
