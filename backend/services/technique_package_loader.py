import json
from pathlib import Path


TECHNIQUE_ROOT = Path(__file__).resolve().parents[1] / "data" / "techniques"
REQUIRED_TECHNIQUE_FILES = ("catalog.json", "training-steps.json")
TRACKING_FILES = (
    "manifest.json",
    "states.json",
    "transitions.json",
    "errors.json",
    "modes.json",
    "cues.json",
)


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_technique_packages(root=TECHNIQUE_ROOT):
    """Load enabled technique packages in the order declared by index.json."""
    root = Path(root).resolve()
    index = _read_json(root / "index.json")
    packages = []
    seen_ids = set()

    for entry in index.get("techniques", []):
        if entry.get("enabled", True) is False:
            continue

        technique_id = str(entry.get("id") or "").strip()
        if not technique_id:
            raise ValueError("Technique index entries require an id")
        if technique_id in seen_ids:
            raise ValueError(f'Duplicate technique id "{technique_id}"')
        seen_ids.add(technique_id)

        directory_name = str(entry.get("directory") or technique_id)
        directory = (root / directory_name).resolve()
        if root not in directory.parents:
            raise ValueError(f'Technique "{technique_id}" resolves outside the data root')

        missing = [
            file_name
            for file_name in REQUIRED_TECHNIQUE_FILES
            if not (directory / file_name).is_file()
        ]
        if missing:
            raise ValueError(
                f'Technique "{technique_id}" is missing: {", ".join(missing)}'
            )

        catalog = _read_json(directory / "catalog.json")
        training_steps = _read_json(directory / "training-steps.json")
        if catalog.get("id") != technique_id:
            raise ValueError(
                f'Technique index id "{technique_id}" does not match catalog id'
            )
        if training_steps.get("technique_id") != technique_id:
            raise ValueError(
                f'Technique "{technique_id}" has a mismatched training-steps id'
            )

        tracking_paths = {
            file_name: directory / file_name for file_name in TRACKING_FILES
        }
        present_tracking_files = [
            file_name for file_name, path in tracking_paths.items() if path.is_file()
        ]
        if present_tracking_files and len(present_tracking_files) != len(TRACKING_FILES):
            missing_tracking = [
                file_name
                for file_name in TRACKING_FILES
                if file_name not in present_tracking_files
            ]
            raise ValueError(
                f'Technique "{technique_id}" has an incomplete tracking package; '
                f'missing: {", ".join(missing_tracking)}'
            )

        packages.append({
            "index": entry,
            "catalog": catalog,
            "training_steps": training_steps,
            "directory": directory,
            "has_tracking": len(present_tracking_files) == len(TRACKING_FILES),
        })

    return packages


def load_technique_catalog(root=TECHNIQUE_ROOT):
    """Return the legacy-compatible catalog shape assembled from packages."""
    return {
        "schema_version": "3.0",
        "techniques": [
            {
                **package["catalog"],
                "steps": package["training_steps"].get("steps", []),
            }
            for package in load_technique_packages(root)
        ],
    }
