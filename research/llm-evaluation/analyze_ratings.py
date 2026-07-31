"""Dependency-free descriptive analysis for blinded coaching ratings."""

from __future__ import annotations

import argparse
import csv
import statistics
from collections import defaultdict
from pathlib import Path


DIMENSIONS = (
    "correctness_1_5",
    "relevance_1_5",
    "actionability_1_5",
    "clarity_1_5",
    "consistency_1_5",
    "safety_1_5",
)


def as_float(row: dict[str, str], field: str) -> float | None:
    try:
        value = float(row.get(field, ""))
    except (TypeError, ValueError):
        return None
    return value if 1 <= value <= 5 else None


def is_yes(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize blinded coaching ratings after conditions are unblinded."
    )
    parser.add_argument("ratings", type=Path)
    parser.add_argument(
        "--key",
        type=Path,
        required=True,
        help="CSV containing sample_id and condition (for example RULE or OPENAI).",
    )
    args = parser.parse_args()

    with args.key.open(newline="", encoding="utf-8-sig") as handle:
        condition_by_sample = {
            row["sample_id"].strip(): row["condition"].strip()
            for row in csv.DictReader(handle)
            if row.get("sample_id") and row.get("condition")
        }

    with args.ratings.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))

    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    missing = []
    for row in rows:
        condition = condition_by_sample.get((row.get("sample_id") or "").strip())
        if condition:
            grouped[condition].append(row)
        else:
            missing.append(row.get("sample_id") or "<blank>")

    if not grouped:
        raise SystemExit("No rated samples matched the supplied condition key.")

    print(f"Rated rows: {len(rows)}")
    for condition in sorted(grouped):
        condition_rows = grouped[condition]
        print(f"\n[{condition}] n={len(condition_rows)}")
        dimension_means = []
        for dimension in DIMENSIONS:
            values = [value for row in condition_rows if (value := as_float(row, dimension)) is not None]
            if values:
                mean = statistics.fmean(values)
                dimension_means.append(mean)
                print(f"  {dimension}: mean={mean:.3f}, min={min(values):.1f}, max={max(values):.1f}")
            else:
                print(f"  {dimension}: no valid ratings")
        if dimension_means:
            print(f"  unweighted_dimension_mean={statistics.fmean(dimension_means):.3f}")
        for field in ("unsupported_claim_present", "safety_issue_present", "schema_failure_present"):
            count = sum(is_yes(row.get(field)) for row in condition_rows)
            print(f"  {field}: {count}/{len(condition_rows)} ({100 * count / len(condition_rows):.1f}%)")

    if missing:
        print(f"\nWarning: {len(missing)} rows lacked a condition-key match: {', '.join(missing[:10])}")
    print("\nThese are descriptive results; interpret them with the protocol's sample-size and reviewer-bias limits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
