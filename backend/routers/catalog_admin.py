"""Admin-only management for the reviewed technique package catalog."""
import json
import math
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_context import require_admin_user
import logging
from database import get_db
from models.user import User
from services.catalog_sync import sync_technique_catalog
from services.reference_pose_schema import normalize_reference_pose
from services.technique_package_loader import LEARNING_CONTENT_FILE, TECHNIQUE_ROOT, TRACKING_FILES


router = APIRouter(prefix="/admin/catalog", tags=["Admin catalog"])
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
METRIC_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
BIOMECHANICS_DOMAINS = {
    "kinematics", "kinetics", "balance", "stability", "alignment",
    "coordination", "footwork", "impact", "efficiency",
}
SOURCE_MODES = {"camera_proxy", "model_estimate", "sensor"}
REVIEW_STATES = {"DRAFT", "IN_REVIEW", "PUBLISHED"}
STRIKING_SURFACES = {
    "", "ball_of_foot", "heel", "instep", "outer_edge",
    "inner_edge", "sole", "toes", "shin", "knee",
}
STRIKING_SIDES = {"", "left", "right", "both"}
GUIDE_DOMAINS = {
    "kinematics", "kinetics", "balance", "stability", "alignment",
    "coordination", "footwork", "timing", "safety", "recovery",
}
SENSOR_OR_ESTIMATE_ONLY = {
    "joint_torque", "ground_reaction_force", "center_of_pressure",
    "impulse", "collision_impact", "friction", "force",
}
ANGLE_LANDMARKS = {
    "elbow_left": ("shoulder_left", "elbow_left", "wrist_left"),
    "elbow_right": ("shoulder_right", "elbow_right", "wrist_right"),
    "shoulder_left": ("elbow_left", "shoulder_left", "hip_left"),
    "shoulder_right": ("elbow_right", "shoulder_right", "hip_right"),
    "hip_left": ("shoulder_left", "hip_left", "knee_left"),
    "hip_right": ("shoulder_right", "hip_right", "knee_right"),
    "knee_left": ("hip_left", "knee_left", "ankle_left"),
    "knee_right": ("hip_right", "knee_right", "ankle_right"),
    "ankle_left": ("knee_left", "ankle_left", "foot_left"),
    "ankle_right": ("knee_right", "ankle_right", "foot_right"),
}


def _reference_angle(landmarks, body_part):
    joints = ANGLE_LANDMARKS.get(body_part)
    if not joints:
        return None
    first, center, last = (landmarks[name] for name in joints)
    left = [value - center[index] for index, value in enumerate(first)]
    right = [value - center[index] for index, value in enumerate(last)]
    denominator = math.sqrt(sum(value * value for value in left) * sum(value * value for value in right))
    if denominator <= 1e-12:
        return 0
    cosine = max(-1.0, min(1.0, sum(a * b for a, b in zip(left, right)) / denominator))
    return round(math.degrees(math.acos(cosine)))


class PackagePayload(BaseModel):
    catalog: dict
    training_steps: dict
    learning_content: dict | None = None
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
        "learning_content": package.get("learning_content"),
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
        learning_content_path = directory / LEARNING_CONTENT_FILE
        packages.append({
            "index": entry,
            "catalog": json.loads(catalog_path.read_text(encoding="utf-8")),
            "training_steps": training_steps,
            "learning_content": (
                json.loads(learning_content_path.read_text(encoding="utf-8"))
                if learning_content_path.is_file()
                else None
            ),
            "directory": directory,
            "has_tracking": bool(training_steps.get("temporal_runtime"))
            or all((directory / filename).is_file() for filename in TRACKING_FILES),
        })
    return packages


def _validate_learning_content(content, package_id):
    if content is None:
        return None
    if not isinstance(content, dict):
        raise HTTPException(400, "Guide content must be a structured configuration")

    status = str(content.get("status") or "DRAFT").upper()
    if status not in REVIEW_STATES:
        raise HTTPException(400, "Guide review status is invalid")
    overview = content.get("overview") or {}
    if not isinstance(overview, dict):
        raise HTTPException(400, "Guide overview must be an object")
    summary = str(overview.get("summary") or "").strip()
    if len(summary) > 1200:
        raise HTTPException(400, "Guide summary must be 1200 characters or fewer")

    def clean_text_list(field, maximum):
        values = overview.get(field, [])
        if not isinstance(values, list) or len(values) > maximum:
            raise HTTPException(400, f"Guide {field} must contain at most {maximum} items")
        return [str(value).strip() for value in values if str(value).strip()]

    principles = content.get("principles", [])
    if not isinstance(principles, list) or len(principles) > 24:
        raise HTTPException(400, "Guide principles must contain at most 24 items")
    clean_principles = []
    seen_ids = set()
    for index, principle in enumerate(principles, start=1):
        if not isinstance(principle, dict):
            raise HTTPException(400, f"Guide principle {index} must be an object")
        principle_id = str(principle.get("id") or "").strip().lower()
        domain = str(principle.get("domain") or "").strip().lower()
        title = str(principle.get("title") or "").strip()
        explanation = str(principle.get("explanation") or "").strip()
        if not METRIC_ID_PATTERN.fullmatch(principle_id) or principle_id in seen_ids:
            raise HTTPException(400, "Guide principles need unique snake_case ids")
        if domain not in GUIDE_DOMAINS:
            raise HTTPException(400, f"Guide domain is invalid for {principle_id}")
        if status == "PUBLISHED" and (not title or not explanation):
            raise HTTPException(400, f"Guide principle {principle_id} needs a title and explanation")
        if len(title) > 120 or len(explanation) > 1200:
            raise HTTPException(400, f"Guide principle {principle_id} is too long")
        seen_ids.add(principle_id)
        clean_principles.append({
            "id": principle_id,
            "domain": domain,
            "title": title,
            "explanation": explanation,
            "related_phases": [
                str(phase).strip().lower()
                for phase in principle.get("related_phases", [])
                if str(phase).strip()
            ],
        })

    if status == "PUBLISHED" and (not summary or not clean_principles):
        raise HTTPException(400, "Published Guide content needs a summary and at least one principle")

    animation = content.get("animation") or {}
    try:
        playback_speed = float(animation.get("playback_speed", 0.75))
    except (TypeError, ValueError):
        raise HTTPException(400, "Guide animation playback speed is invalid") from None
    if not 0.25 <= playback_speed <= 2:
        raise HTTPException(400, "Guide animation playback speed must be between 0.25 and 2")

    return {
        "schema_version": str(content.get("schema_version") or "1.0"),
        "technique_id": package_id,
        "status": status,
        "overview": {
            "summary": summary,
            "objectives": clean_text_list("objectives", 12),
            "safety": clean_text_list("safety", 12),
        },
        "principles": clean_principles,
        "animation": {
            "source": "training_steps",
            "loop": bool(animation.get("loop", True)),
            "playback_speed": playback_speed,
            "camera_preset": str(animation.get("camera_preset") or "front_diagonal"),
            "show_trajectory": bool(animation.get("show_trajectory", True)),
            "highlight_joints": [
                str(joint).strip()
                for joint in animation.get("highlight_joints", [])
                if str(joint).strip()
            ][:12],
        },
    }


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
    if not isinstance(steps, list) or not 1 <= len(steps) <= 12:
        raise HTTPException(400, "Each technique needs between one and twelve ordered steps")
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict) or not str(step.get("step_name") or "").strip():
            raise HTTPException(400, f"Step {index} needs a name")
        step["step_number"] = index
        striking_surface = str(step.get("striking_surface") or "").strip().lower()
        if striking_surface not in STRIKING_SURFACES:
            raise HTTPException(400, f"Step {index} has an unsupported striking surface")
        step["striking_surface"] = striking_surface
        striking_side = str(step.get("striking_side") or "").strip().lower()
        if striking_side not in STRIKING_SIDES:
            raise HTTPException(400, f"Step {index} has an unsupported striking side")
        if striking_surface and not striking_side:
            raise HTTPException(400, f"Step {index} needs a striking side")
        step["striking_side"] = striking_side
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

        if index < len(steps):
            try:
                transition_duration = int(step.get("transition_duration_ms", 1600))
            except (TypeError, ValueError):
                raise HTTPException(400, f"Step {index} has an invalid transition duration") from None
            if not 200 <= transition_duration <= 10000:
                raise HTTPException(400, f"Step {index} transition duration must be between 200 and 10000 ms")
            step["transition_duration_ms"] = transition_duration
        else:
            step.pop("transition_duration_ms", None)

        reference_pose = step.get("reference_pose")
        if reference_pose is not None:
            step["reference_pose"] = normalize_reference_pose(reference_pose, index)
            landmarks = step["reference_pose"]["landmarks"]
            for target in targets:
                reference_angle = _reference_angle(landmarks, target["body_part"])
                if reference_angle is None:
                    continue
                if not target["min"] <= reference_angle <= target["max"]:
                    raise HTTPException(
                        400,
                        f"Step {index} {target['body_part']} reference pose is {reference_angle}°, outside its {target['min']:g}–{target['max']:g}° range",
                    )
                # The saved skeleton is the authoritative pose. Keep the
                # target center synchronized while preserving reviewer-set
                # minimum and maximum tolerances.
                target["target_angle"] = reference_angle

        # The manual catalog is the sole authoring path. Drop stale optimizer
        # metadata from packages created by the retired optimization studio.
        step.pop("pose_optimization", None)

    cycle = training_steps.get("cycle")
    if cycle is not None:
        if not isinstance(cycle, dict):
            raise HTTPException(400, "Technique cycle must be a structured configuration")
        cycle["enabled"] = bool(cycle.get("enabled", False))
        try:
            return_step = int(cycle.get("return_to_step_number", 1))
            return_duration = int(cycle.get("transition_duration_ms", 900))
        except (TypeError, ValueError):
            raise HTTPException(400, "Technique cycle has invalid return data") from None
        if not 1 <= return_step <= len(steps):
            raise HTTPException(400, "Technique cycle return step is outside the step sequence")
        if not 200 <= return_duration <= 10000:
            raise HTTPException(400, "Technique cycle transition must be between 200 and 10000 ms")
        cycle.update({
            "return_to_step_number": return_step,
            "transition_duration_ms": return_duration,
            "description": str(cycle.get("description") or "").strip(),
        })

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
    learning_content = _validate_learning_content(payload.learning_content, package_id)
    return package_id, catalog, training_steps, learning_content


def _save_package(package_id, catalog, training_steps, learning_content, enabled, creating):
    package_dir = (TECHNIQUE_ROOT / package_id).resolve()
    if TECHNIQUE_ROOT.resolve() not in package_dir.parents:
        raise HTTPException(400, "Invalid technique id")
    if creating:
        package_dir.mkdir(exist_ok=False)
    _write_json(package_dir / "catalog.json", catalog)
    _write_json(package_dir / "training-steps.json", training_steps)
    if learning_content is not None:
        _write_json(package_dir / LEARNING_CONTENT_FILE, learning_content)

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
    package_id, catalog, training_steps, learning_content = _validate_payload(payload)
    if (TECHNIQUE_ROOT / package_id).exists():
        raise HTTPException(409, "A technique with this id already exists")
    _save_package(package_id, catalog, training_steps, learning_content, payload.enabled, creating=True)
    try:
        sync_technique_catalog(db)
    except Exception:
        logging.getLogger(__name__).exception("Catalog saved to files but failed to sync with database")
    return {"message": "Technique created", "id": package_id}


@router.put("/{technique_id}")
def update_package(technique_id: str, payload: PackagePayload, db: Session = Depends(get_db), _admin: User = Depends(require_admin_user)):
    if not (TECHNIQUE_ROOT / technique_id).is_dir():
        raise HTTPException(404, "Technique package not found")
    package_id, catalog, training_steps, learning_content = _validate_payload(payload, technique_id)
    _save_package(package_id, catalog, training_steps, learning_content, payload.enabled, creating=False)
    try:
        sync_technique_catalog(db)
    except Exception:
        logging.getLogger(__name__).exception("Catalog updated on disk but failed to sync with database")
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
