#!/usr/bin/env python3
"""Validate a Combat Cognition pilot run and emit descriptive JSON summaries."""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

REQUIRED = {
    "participant_sessions.csv": {"participant_id", "session_id"},
    "trials.csv": {"trial_id", "clip_id", "condition", "output_id", "eligible_yes_no"},
    "phase_annotations.csv": {"clip_id", "phase", "start_frame", "end_frame"},
    "frame_predictions.csv": {
        "output_id", "participant_id", "clip_id", "condition", "frame_index",
        "ground_truth_phase", "predicted_phase", "tracking_available"
    },
    "feedback_ratings.csv": {"feedback_event_id", "blinded_output_id", "safety_1_5"},
    "usability_ratings.csv": {"participant_id", "session_id", "ease_of_use_1_5"},
    "failure_log.csv": {"failure_id", "category", "severity_1_4"},
    "artifact_manifest.csv": {"artifact_id", "sha256", "access_class"},
}
CONDITIONS = {"rule_only", "hybrid_template"}


def rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def yes(value: str) -> bool:
    return value.strip().lower() in {"yes", "y", "true", "1"}


def number(value: str) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def describe(values: list[float]) -> dict:
    values = sorted(values)
    if not values:
        return {"n": 0}
    index = max(0, math.ceil(0.95 * len(values)) - 1)
    return {
        "n": len(values),
        "mean": round(statistics.fmean(values), 4),
        "median": round(statistics.median(values), 4),
        "min": round(values[0], 4),
        "max": round(values[-1], 4),
        "p95_nearest_rank": round(values[index], 4),
    }


def macro_f1(actual: list[str], predicted: list[str]) -> float | None:
    labels = sorted(set(actual) | set(predicted))
    if not labels:
        return None
    scores = []
    for label in labels:
        tp = sum(a == label and p == label for a, p in zip(actual, predicted))
        fp = sum(a != label and p == label for a, p in zip(actual, predicted))
        fn = sum(a == label and p != label for a, p in zip(actual, predicted))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        scores.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    return round(statistics.fmean(scores), 4)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="Pilot run directory")
    parser.add_argument("--output", type=Path, help="Defaults to <input>/pilot_summary.json")
    args = parser.parse_args()
    errors, warnings, data = [], [], {}

    for filename, required_columns in REQUIRED.items():
        path = args.input / filename
        if not path.exists():
            errors.append(f"missing required file: {filename}")
            continue
        data[filename] = rows(path)
        present = set(data[filename][0]) if data[filename] else set()
        missing = sorted(required_columns - present)
        if missing:
            errors.append(f"{filename}: missing columns {missing}")

    if errors:
        print(json.dumps({"status": "invalid", "errors": errors}, indent=2))
        return 2

    sessions = data["participant_sessions.csv"]
    trials = data["trials.csv"]
    frames = data["frame_predictions.csv"]
    feedback = data["feedback_ratings.csv"]
    usability = data["usability_ratings.csv"]
    failures = data["failure_log.csv"]
    artifacts = data["artifact_manifest.csv"]

    participants = sorted({r["participant_id"] for r in sessions if r["participant_id"]})
    if len(participants) != 1:
        warnings.append(f"expected 1 researcher-expert participant; found {len(participants)}")

    eligible = [r for r in trials if yes(r["eligible_yes_no"])]
    paired = defaultdict(set)
    for row in eligible:
        paired[(row.get("participant_id"), row.get("session_id"), row["clip_id"])].add(row["condition"])
    incomplete_pairs = ["/".join(filter(None, key)) for key, value in paired.items() if not CONDITIONS <= value]
    if incomplete_pairs:
        warnings.append(f"eligible clips missing paired conditions: {incomplete_pairs}")

    condition_summary = {}
    for condition in sorted(CONDITIONS | {r["condition"] for r in frames if r["condition"]}):
        selected = [r for r in frames if r["condition"] == condition]
        labeled = [r for r in selected if r["ground_truth_phase"] and r["predicted_phase"]]
        actual = [r["ground_truth_phase"] for r in labeled]
        predicted = [r["predicted_phase"] for r in labeled]
        latency = []
        for row in selected:
            t0, t4 = number(row.get("t0_capture_ms", "")), number(row.get("t4_render_ms", ""))
            if t0 is not None and t4 is not None and t4 >= t0:
                latency.append(t4 - t0)
        condition_summary[condition] = {
            "frames": len(selected),
            "labeled_frames": len(labeled),
            "phase_accuracy": round(sum(a == p for a, p in zip(actual, predicted)) / len(actual), 4) if actual else None,
            "phase_macro_f1": macro_f1(actual, predicted),
            "tracking_availability": round(sum(yes(r["tracking_available"]) for r in selected) / len(selected), 4) if selected else None,
            "end_to_end_latency_ms": describe(latency),
        }

    rating_fields = [
        "correctness_1_5", "relevance_1_5", "actionability_1_5", "clarity_1_5",
        "groundedness_1_5", "safety_1_5"
    ]
    feedback_summary = {field: describe([v for r in feedback if (v := number(r.get(field, ""))) is not None]) for field in rating_fields}
    feedback_summary["unsupported_claim_count"] = sum(yes(r.get("unsupported_claim_yes_no", "")) for r in feedback)
    feedback_summary["medical_or_guarantee_count"] = sum(yes(r.get("medical_or_guarantee_yes_no", "")) for r in feedback)

    usability_fields = [key for key in (usability[0].keys() if usability else []) if key.endswith("_1_5")]
    usability_summary = {field: describe([v for r in usability if (v := number(r.get(field, ""))) is not None]) for field in usability_fields}

    hashes_missing = sum(not r.get("sha256", "").strip() for r in artifacts)
    if hashes_missing:
        warnings.append(f"artifact rows without SHA-256: {hashes_missing}")

    summary = {
        "status": "valid_with_warnings" if warnings else "valid",
        "scope_warning": "Single-participant expert feasibility case; do not generalize to a population.",
        "participants": participants,
        "eligible_clips": len(paired),
        "complete_paired_clips": sum(CONDITIONS <= value for value in paired.values()),
        "condition_summary": condition_summary,
        "feedback_summary": feedback_summary,
        "usability_summary": usability_summary,
        "failures_by_category": dict(Counter(r["category"] or "unspecified" for r in failures)),
        "failures_by_severity": dict(Counter(r["severity_1_4"] or "unspecified" for r in failures)),
        "artifact_count": len(artifacts),
        "warnings": warnings,
    }
    output = args.output or args.input / "pilot_summary.json"
    output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
