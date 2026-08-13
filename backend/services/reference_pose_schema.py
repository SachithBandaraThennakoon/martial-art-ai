"""Validation and normalization for manually authored reference poses."""

from math import isfinite, pi

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


def _number(value, message):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, message) from None


def _normalize_articulation(reference_pose, prefix):
    source = reference_pose.get("articulation") or {}
    if not isinstance(source, dict):
        raise HTTPException(400, f"{prefix} articulation must be an object")
    defaults = {
        "face": {"gaze_horizontal": 0.0, "gaze_vertical": 0.0, "eye_openness": 1.0, "tension": 0.35, "jaw_openness": 0.0},
        "hand_left": {"fist_closure": 0.0, "finger_spread": 0.35, "palm_turn": 0.0},
        "hand_right": {"fist_closure": 0.0, "finger_spread": 0.35, "palm_turn": 0.0},
    }
    normalized = {}
    for group, fields in defaults.items():
        group_source = source.get(group) or {}
        if not isinstance(group_source, dict):
            raise HTTPException(400, f"{prefix} articulation {group} must be an object")
        normalized[group] = {}
        for field, default in fields.items():
            value = _number(group_source.get(field, default), f"{prefix} has invalid articulation data for {group}.{field}")
            minimum = -1.0 if field.startswith("gaze_") else 0.0
            if not minimum <= value <= 1.0:
                raise HTTPException(400, f"{prefix} articulation {group}.{field} must be between {minimum:g} and 1")
            normalized[group][field] = round(value, 4)
        if group.startswith("hand_"):
            rotation = group_source.get("wrist_rotation", [0.0, 0.0, 0.0])
            if not isinstance(rotation, list) or len(rotation) != 3:
                raise HTTPException(400, f"{prefix} articulation {group}.wrist_rotation must contain XYZ radians")
            normalized_rotation = [
                _number(value, f"{prefix} has invalid articulation data for {group}.wrist_rotation")
                for value in rotation
            ]
            if any(not isfinite(value) or abs(value) > 2 * pi for value in normalized_rotation):
                raise HTTPException(400, f"{prefix} articulation {group}.wrist_rotation must use finite radians between -2π and 2π")
            normalized[group]["wrist_rotation"] = [round(value, 4) for value in normalized_rotation]
    return normalized


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
        "articulation": _normalize_articulation(reference_pose, prefix),
    }
