"""Admin-only management for the reviewed technique package catalog."""
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_context import require_admin_user
from database import get_db
from models.user import User
from services.catalog_sync import sync_technique_catalog
from services.technique_package_loader import TECHNIQUE_ROOT, TRACKING_FILES


router = APIRouter(prefix="/admin/catalog", tags=["Admin catalog"])
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
METRIC_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
BIOMECHANICS_DOMAINS = {
    "kinematics", "kinetics", "balance", "stability", "alignment",
    "coordination", "footwork", "impact", "efficiency",
}
SOURCE_MODES = {"camera_proxy", "model_estimate", "sensor"}
REVIEW_STATES = {"DRAFT", "IN_REVIEW", "PUBLISHED"}
SENSOR_OR_ESTIMATE_ONLY = {
    "joint_torque", "ground_reaction_force", "center_of_pressure",
    "impulse", "collision_impact", "friction", "force",
}


class PackagePayload(BaseModel):
    catalog: dict
    training_steps: dict
    enabled: bool = True


def _read_index():
    return json.loads((TECHNIQUE_ROOT / "index.json").read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _package_payload(package):
    return {
        "id": package["catalog"]["id"],
        "enabled": package["index"].get("enabled", True),
        "catalog": package["catalog"],
        "training_steps": package["training_steps"],
        "has_tracking": package["has_tracking"],
    }


def _load_all_packages():
    """Load active and archived packages for administration."""
    root = TECHNIQUE_ROOT.resolve()
    packages = []
    for entry in _read_index().get("techniques", []):
        package_id = str(entry.get("id") or "").strip()
        directory = (root / str(entry.get("directory") or package_id)).resolve()
        if not package_id or root not in directory.parents:
            continue
        catalog_path = directory / "catalog.json"
        steps_path = directory / "training-steps.json"
        if not catalog_path.is_file() or not steps_path.is_file():
            continue
        training_steps = json.loads(steps_path.read_text(encoding="utf-8"))
        packages.append({
            "index": entry,
            "catalog": json.loads(catalog_path.read_text(encoding="utf-8")),
            "training_steps": training_steps,
            "directory": directory,
            "has_tracking": bool(training_steps.get("temporal_runtime"))
            or all((directory / filename).is_file() for filename in TRACKING_FILES),
        })
    return packages


def _validate_payload(payload: PackagePayload, technique_id: str | None = None):
    catalog = dict(payload.catalog)
    training_steps = dict(payload.training_steps)
    package_id = str(catalog.get("id") or technique_id or "").strip().lower()
    if not ID_PATTERN.fullmatch(package_id):
        raise HTTPException(400, "Use a lowercase id such as 'jab' or 'front-kick'")
    if technique_id and package_id != technique_id:
        raise HTTPException(400, "A technique id cannot be changed after creation")

    name = str(catalog.get("name") or "").strip()
    description = str(catalog.get("description") or "").strip()
    if not name or len(name) > 160:
        raise HTTPException(400, "Technique name is required and must be 160 characters or fewer")
    if len(description) < 20:
        raise HTTPException(400, "Add a description with setup or safety guidance (at least 20 characters)")

    steps = training_steps.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 3:
        raise HTTPException(400, "Each technique needs between one and three ordered steps")
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict) or not str(step.get("step_name") or "").strip():
            raise HTTPException(400, f"Step {index} needs a name")
        step["step_number"] = index
        targets = step.get("angle_targets", step.get("angles", []))
        if not isinstance(targets, list) or not targets:
            raise HTTPException(400, f"Step {index} needs at least one angle range")
        seen_targets = set()
        for target in targets:
            body_part = str(target.get("body_part") or "").strip()
            if not body_part or body_part in seen_targets:
                raise HTTPException(400, f"Step {index} has an invalid or duplicate body part")
            seen_targets.add(body_part)
            try:
                minimum = float(target.get("min", target.get("min_angle")))
                maximum = float(target.get("max", target.get("max_angle")))
            except (TypeError, ValueError):
                raise HTTPException(400, f"Step {index} has an invalid range for {body_part}")
            if minimum < 0 or maximum > 180 or minimum > maximum:
                raise HTTPException(400, f"Step {index} has an invalid range for {body_part}")
            target["body_part"] = body_part
            target["min"] = minimum
            target["max"] = maximum
        step["angle_targets"] = targets
        step.pop("angles", None)

    biomechanics = training_steps.get("biomechanics")
    if biomechanics is not None:
        if not isinstance(biomechanics, dict):
            raise HTTPException(400, "Biomechanics must be a structured configuration")
        review_status = str(biomechanics.get("review_status") or "DRAFT").upper()
        if review_status not in REVIEW_STATES:
            raise HTTPException(400, "Biomechanics review status is invalid")
        measurements = biomechanics.get("measurements", [])
        if not isinstance(measurements, list):
            raise HTTPException(400, "Biomechanics measurements must be a list")
        seen_measurements = set()
        for metric in measurements:
            if not isinstance(metric, dict):
                raise HTTPException(400, "Each biomechanics measurement must be an object")
            metric_id = str(metric.get("id") or "").strip().lower()
            if not METRIC_ID_PATTERN.fullmatch(metric_id) or metric_id in seen_measurements:
                raise HTTPException(400, "Biomechanics measurements need unique snake_case ids")
            seen_measurements.add(metric_id)
            domain = str(metric.get("domain") or "").strip().lower()
            source_mode = str(metric.get("source_mode") or "").strip().lower()
            if domain not in BIOMECHANICS_DOMAINS:
                raise HTTPException(400, f"Biomechanics domain is invalid for {metric_id}")
            if source_mode not in SOURCE_MODES:
                raise HTTPException(400, f"Select a valid data source for {metric_id}")
            if metric_id in SENSOR_OR_ESTIMATE_ONLY and source_mode == "camera_proxy":
                raise HTTPException(
                    400,
                    f"{metric_id} cannot be presented as a direct camera measurement; use a sensor or model estimate",
                )
            for field in ("target", "min", "max"):
                if metric.get(field) in (None, ""):
                    metric.pop(field, None)
                    continue
                try:
                    metric[field] = float(metric[field])
                except (TypeError, ValueError):
                    raise HTTPException(400, f"Biomechanics {field} is invalid for {metric_id}")
            if metric.get("min") is not None and metric.get("max") is not None and metric["min"] > metric["max"]:
                raise HTTPException(400, f"Biomechanics range is invalid for {metric_id}")
            metric.update({
                "id": metric_id,
                "name": str(metric.get("name") or metric_id.replace("_", " ").title()).strip(),
                "domain": domain,
                "source_mode": source_mode,
                "unit": str(metric.get("unit") or "score").strip(),
                "formula": str(metric.get("formula") or "Documented by reviewer").strip(),
                "phases": [str(phase) for phase in metric.get("phases", []) if str(phase).strip()],
            })
        if review_status == "PUBLISHED":
            incomplete = [metric["id"] for metric in measurements if not metric.get("formula") or metric.get("formula") == "Documented by reviewer"]
            if incomplete:
                raise HTTPException(400, "Published biomechanics measurements require documented formulas")
        biomechanics.update({
            "schema_version": str(biomechanics.get("schema_version") or "1.0"),
            "review_status": review_status,
            "measurements": measurements,
            "reviewed_by": str(biomechanics.get("reviewed_by") or "").strip() or None,
        })

    catalog.update({
        "schema_version": str(catalog.get("schema_version") or "1.0"),
        "id": package_id,
        "name": name,
        "tracking_package": str(catalog.get("tracking_package") or package_id),
        "tracking_version": str(catalog.get("tracking_version") or "1.0.0"),
        "category": str(catalog.get("category") or "Technique Training").strip(),
        "subcategory": str(catalog.get("subcategory") or "General").strip(),
        "difficulty": str(catalog.get("difficulty") or "Beginner").strip(),
        "price": max(0, float(catalog.get("price") or 0)),
        "required_plan": str(catalog.get("required_plan") or "FREE_PLAN").strip().upper(),
        "description": description,
    })
    training_steps.update({
        "schema_version": str(training_steps.get("schema_version") or "2.0"),
        "technique_id": package_id,
        "steps": steps,
    })
    return package_id, catalog, training_steps


def _save_package(package_id, catalog, training_steps, enabled, creating):
    package_dir = (TECHNIQUE_ROOT / package_id).resolve()
    if TECHNIQUE_ROOT.resolve() not in package_dir.parents:
        raise HTTPException(400, "Invalid technique id")
    if creating:
        package_dir.mkdir(exist_ok=False)
    _write_json(package_dir / "catalog.json", catalog)
    _write_json(package_dir / "training-steps.json", training_steps)

    index = _read_index()
    entries = index.setdefault("techniques", [])
    entry = next((item for item in entries if item.get("id") == package_id), None)
    if not entry:
        entry = {"id": package_id, "directory": package_id}
        entries.append(entry)
    entry.update({"id": package_id, "directory": package_id, "enabled": enabled})
    _write_json(TECHNIQUE_ROOT / "index.json", index)


@router.get("")
def list_packages(_admin: User = Depends(require_admin_user)):
    return {"techniques": [_package_payload(item) for item in _load_all_packages()]}


@router.get("/{technique_id}")
def get_package(technique_id: str, _admin: User = Depends(require_admin_user)):
    package = next((item for item in _load_all_packages() if item["catalog"]["id"] == technique_id), None)
    if not package:
        raise HTTPException(404, "Technique package not found")
    return _package_payload(package)


@router.post("")
def create_package(payload: PackagePayload, db: Session = Depends(get_db), _admin: User = Depends(require_admin_user)):
    package_id, catalog, training_steps = _validate_payload(payload)
    if (TECHNIQUE_ROOT / package_id).exists():
        raise HTTPException(409, "A technique with this id already exists")
    _save_package(package_id, catalog, training_steps, payload.enabled, creating=True)
    sync_technique_catalog(db)
    return {"message": "Technique created", "id": package_id}


@router.put("/{technique_id}")
def update_package(technique_id: str, payload: PackagePayload, db: Session = Depends(get_db), _admin: User = Depends(require_admin_user)):
    if not (TECHNIQUE_ROOT / technique_id).is_dir():
        raise HTTPException(404, "Technique package not found")
    package_id, catalog, training_steps = _validate_payload(payload, technique_id)
    _save_package(package_id, catalog, training_steps, payload.enabled, creating=False)
    sync_technique_catalog(db)
    return {"message": "Technique updated", "id": package_id}


@router.delete("/{technique_id}")
def archive_package(technique_id: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin_user)):
    index = _read_index()
    entry = next((item for item in index.get("techniques", []) if item.get("id") == technique_id), None)
    if not entry:
        raise HTTPException(404, "Technique package not found")
    entry["enabled"] = False
    _write_json(TECHNIQUE_ROOT / "index.json", index)
    sync_technique_catalog(db)
    return {"message": "Technique archived", "id": technique_id}
