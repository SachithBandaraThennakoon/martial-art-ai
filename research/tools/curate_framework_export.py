#!/usr/bin/env python3
"""Create an immutable, hashed subset from a Combat Cognition research export."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def digest(document):
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--practice-session", action="append", required=True)
    parser.add_argument("--reason", required=True)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8-sig"))
    selected_ids = set(args.practice_session)
    selected = [row for row in source.get("practice_sessions", []) if row.get("session_id") in selected_ids]
    found = {row.get("session_id") for row in selected}
    missing = sorted(selected_ids - found)
    if missing:
        raise SystemExit(f"Practice sessions not found: {missing}")

    subset = {
        "schema": "combat-cognition-curated-framework-subset/v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_schema": source.get("schema"),
        "source_content_sha256": source.get("content_sha256"),
        "participant_id": source.get("participant_id"),
        "selection": {
            "included_practice_session_ids": sorted(selected_ids),
            "excluded_practice_session_count": len(source.get("practice_sessions", [])) - len(selected),
            "excluded_training_session_count": len(source.get("training_sessions", [])),
            "reason": args.reason,
            "selection_timing": "researcher_confirmed_before_final_framework_analysis",
        },
        "scope": source.get("scope"),
        "practice_sessions": selected,
        "training_sessions": [],
        "claim_controls": [
            "System scores are not independent ground-truth accuracy.",
            "Disagreement between stored layers is retained as a failure finding.",
            "Historical/development records are excluded from headline evaluation.",
            "Single-participant jab evidence is not population-generalizable.",
        ],
    }
    subset["content_sha256"] = digest(subset)
    args.output.write_text(json.dumps(subset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "included": sorted(selected_ids),
        "bytes": args.output.stat().st_size,
        "content_sha256": subset["content_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
