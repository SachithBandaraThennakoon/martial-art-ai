"""Validate system-catalog technique filenames against their internal slugs."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "system-catalog" / "techniques"


def main() -> int:
    errors: list[str] = []
    seen: dict[str, Path] = {}

    for path in sorted(ROOT.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"{path.name}: invalid JSON ({error})")
            continue

        slug = str((payload.get("technique") or {}).get("slug") or "").strip()
        if not slug:
            errors.append(f"{path.name}: missing technique.slug")
            continue
        if path.stem != slug and not path.stem.endswith(f"--{slug}"):
            errors.append(f"{path.name}: filename stem does not match technique.slug={slug}")
        if slug in seen:
            errors.append(f"duplicate technique.slug={slug}: {seen[slug].name} and {path.name}")
        else:
            seen[slug] = path

    if errors:
        print("System catalog filename validation failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1

    print(f"System catalog filename validation passed: {len(seen)} records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
