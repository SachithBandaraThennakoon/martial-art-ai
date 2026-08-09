"""Validation and normalization for static-pose optimization configuration."""

from copy import deepcopy
from math import isfinite

from fastapi import HTTPException


POSE_BONES = (
    ("head", "shoulder_left"), ("head", "shoulder_right"),
    ("shoulder_left", "shoulder_right"), ("shoulder_left", "elbow_left"),
    ("elbow_left", "wrist_left"), ("shoulder_right", "elbow_right"),
    ("elbow_right", "wrist_right"), ("shoulder_left", "hip_left"),
    ("shoulder_right", "hip_right"), ("hip_left", "hip_right"),
    ("hip_left", "knee_left"), ("knee_left", "ankle_left"),
    ("ankle_left", "foot_left"), ("hip_right", "knee_right"),
    ("knee_right", "ankle_right"), ("ankle_right", "foot_right"),
)
POSE_LANDMARKS = {joint for bone in POSE_BONES for joint in bone}
OPTIMIZATION_STATES = {"DRAFT", "READY", "COMPLETED"}
DEFAULT_OBJECTIVE_WEIGHTS = {
    "energy_efficiency_proxy": 1.0,
    "static_stability": 1.0,
    "defense": 1.0,
    "readiness": 1.0,
    "power_potential_proxy": 1.0,
    "mobility": 1.0,
    "structural_efficiency": 1.0,
    "joint_safety": 1.0,
}


def _number(value, message):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, message) from None


def normalize_reference_pose(reference_pose, step_index, label="reference pose"):
    """Return one canonical body-normalized pose or raise an actionable 400."""
    prefix = f"Step {step_index} {label}"
    if not isinstance(reference_pose, dict):
        raise HTTPException(400, f"{prefix} must be an object")
    coordinate_space = str(reference_pose.get("coordinate_space") or "")
    if coordinate_space != "body_normalized_v1":
        raise HTTPException(400, f"{prefix} must use body_normalized_v1")
    landmarks = reference_pose.get("landmarks")
    if not isinstance(landmarks, dict) or not landmarks:
        raise HTTPException(400, f"{prefix} needs landmarks")

    tolerance = _number(reference_pose.get("tolerance", 0.12), f"{prefix} has an invalid position tolerance")
    if not 0.01 <= tolerance <= 0.5:
        raise HTTPException(400, f"{prefix} position tolerance must be between 0.01 and 0.5")

    normalized_landmarks = {}
    for body_part, position in landmarks.items():
        body_part = str(body_part).strip()
        if not body_part or not isinstance(position, list) or len(position) != 3:
            raise HTTPException(400, f"{prefix} has an invalid position for {body_part or 'unknown joint'}")
        coordinates = [_number(value, f"{prefix} has non-numeric position data for {body_part}") for value in position]
        if any(abs(value) > 5 for value in coordinates):
            raise HTTPException(400, f"{prefix} position for {body_part} is outside the normalized body space")
        normalized_landmarks[body_part] = coordinates

    missing_landmarks = sorted(POSE_LANDMARKS - normalized_landmarks.keys())
    if missing_landmarks:
        raise HTTPException(400, f"{prefix} is missing: {', '.join(missing_landmarks)}")

    bones = []
    for first, second in POSE_BONES:
        first_position = normalized_landmarks[first]
        second_position = normalized_landmarks[second]
        length = sum((value - second_position[axis]) ** 2 for axis, value in enumerate(first_position)) ** 0.5
        bones.append({"from": first, "to": second, "length": round(length, 4)})

    return {
        "schema_version": str(reference_pose.get("schema_version") or "1.0"),
        "coordinate_space": coordinate_space,
        "origin": "hip_center",
        "scale_basis": "torso_length",
        "tolerance": tolerance,
        "landmarks": normalized_landmarks,
        "bones": bones,
    }


def validate_pose_optimization(configuration, step_index):
    """Validate endpoint poses and reproducible settings without running optimization."""
    if not isinstance(configuration, dict):
        raise HTTPException(400, f"Step {step_index} pose optimization must be an object")
    normalized = deepcopy(configuration)
    status = str(configuration.get("status") or "DRAFT").upper()
    if status not in OPTIMIZATION_STATES:
        raise HTTPException(400, f"Step {step_index} pose optimization status is invalid")

    for field, label in (("pose_a", "Pose A"), ("pose_b", "Pose B")):
        pose = configuration.get(field)
        if pose is not None:
            normalized[field] = normalize_reference_pose(pose, step_index, label)

    if status != "DRAFT" and (not normalized.get("pose_a") or not normalized.get("pose_b")):
        raise HTTPException(400, f"Step {step_index} needs both Pose A and Pose B before optimization")

    margin = configuration.get("margin") or {}
    if not isinstance(margin, dict):
        raise HTTPException(400, f"Step {step_index} pose optimization margin must be an object")
    angle_margin = _number(margin.get("angle_degrees", 0), f"Step {step_index} has an invalid angle margin")
    position_margin = _number(margin.get("position_normalized", 0), f"Step {step_index} has an invalid position margin")
    if not 0 <= angle_margin <= 30:
        raise HTTPException(400, f"Step {step_index} angle margin must be between 0 and 30 degrees")
    if not isfinite(position_margin) or position_margin < 0:
        raise HTTPException(400, f"Step {step_index} position margin must be a finite non-negative number")

    weights = configuration.get("objective_weights") or DEFAULT_OBJECTIVE_WEIGHTS
    if not isinstance(weights, dict):
        raise HTTPException(400, f"Step {step_index} objective weights must be an object")
    unknown = sorted(set(weights) - set(DEFAULT_OBJECTIVE_WEIGHTS))
    if unknown:
        raise HTTPException(400, f"Step {step_index} has unknown optimization objectives: {', '.join(unknown)}")
    normalized_weights = dict(DEFAULT_OBJECTIVE_WEIGHTS)
    for objective, value in weights.items():
        weight = _number(value, f"Step {step_index} has an invalid weight for {objective}")
        if not 0 <= weight <= 10:
            raise HTTPException(400, f"Step {step_index} weight for {objective} must be between 0 and 10")
        normalized_weights[objective] = weight

    try:
        seed = int(configuration.get("seed", 42))
    except (TypeError, ValueError):
        raise HTTPException(400, f"Step {step_index} optimization seed must be an integer") from None
    if not 0 <= seed <= 2_147_483_647:
        raise HTTPException(400, f"Step {step_index} optimization seed is outside the supported range")

    normalized.update({
        "schema_version": str(configuration.get("schema_version") or "1.0"),
        "status": status,
        "seed": seed,
        "margin": {"angle_degrees": angle_margin, "position_normalized": position_margin},
        "objective_weights": normalized_weights,
    })
    return normalized
