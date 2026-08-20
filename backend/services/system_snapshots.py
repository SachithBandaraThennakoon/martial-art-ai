"""Generated, read-only JSON snapshots for public system data.

Snapshots contain catalog and technique definitions only. They intentionally
exclude users, sessions, progress, recordings, payments, and all personal data.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


SNAPSHOT_ROOT = Path(
    os.getenv("SYSTEM_DATA_SNAPSHOT_DIR")
    or Path(__file__).resolve().parent.parent / "data" / "system-catalog"
)
CATALOG_SNAPSHOT_PATH = SNAPSHOT_ROOT / "catalog-index.json"
TECHNIQUE_SNAPSHOT_DIR = SNAPSHOT_ROOT / "techniques"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    with temporary_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    temporary_path.replace(path)


def load_catalog_snapshot() -> dict[str, Any] | None:
    return _read_json(CATALOG_SNAPSHOT_PATH)


def load_technique_snapshot(slug: str) -> dict[str, Any] | None:
    safe_slug = str(slug or "").strip().lower()
    if not safe_slug or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in safe_slug):
        return None
    return _read_json(TECHNIQUE_SNAPSHOT_DIR / f"{safe_slug}.json")


def technique_snapshot_payload(technique) -> dict[str, Any]:
    """Serialize only non-user, runtime technique fields."""
    return {
        "technique": {
            "id": technique.id,
            "slug": technique.slug,
            "name": technique.name,
            "description": technique.description,
            "difficulty": technique.difficulty,
            "status": technique.status,
            "version": technique.version,
            "category": technique.category,
            "subcategory": technique.subcategory,
            "price": technique.price,
            "required_plan": technique.required_plan,
            "metadata": technique.metadata_json,
        },
        "training_config": technique.training_config,
        "learning_content": technique.learning_content,
    }


def write_system_snapshots(catalog: dict[str, Any], techniques) -> dict[str, int]:
    """Atomically write current system definitions after an admin refresh."""
    _write_json(CATALOG_SNAPSHOT_PATH, catalog)
    total = 0
    for technique in techniques:
        _write_json(
            TECHNIQUE_SNAPSHOT_DIR / f"{technique.slug}.json",
            technique_snapshot_payload(technique),
        )
        total += 1
    return {"techniques": total, "catalog_nodes": len(catalog.get("nodes", []))}
