"""Deterministic constrained inverse kinematics for optimized static poses."""

import numpy as np
from fastapi import HTTPException
from scipy.optimize import least_squares

from services.pose_optimization_schema import POSE_BONES, POSE_LANDMARKS, normalize_reference_pose
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


KINEMATICS_VERSION = "1.1.0"
LANDMARK_ORDER = tuple(sorted(POSE_LANDMARKS))
ANGLE_ERROR_LIMIT = 5.0
POSITION_ERROR_LIMIT = 0.08
BONE_RELATIVE_ERROR_LIMIT = 0.03


def _pose_array(reference_pose):
    return np.array([reference_pose["landmarks"][name] for name in LANDMARK_ORDER], dtype=float)


def _landmarks(values):
    matrix = np.asarray(values, dtype=float).reshape((len(LANDMARK_ORDER), 3))
    return {name: matrix[index].tolist() for index, name in enumerate(LANDMARK_ORDER)}


def _angle_delta(actual, target):
    difference = (actual - target + 180) % 360 - 180
    return difference


def _unit(vector):
    length = np.linalg.norm(vector)
    return vector / max(length, 1e-12)


def _place(matrix, index, target_bones, parent, child, direction):
    matrix[index[child]] = (
        matrix[index[parent]]
        + _unit(np.asarray(direction, dtype=float)) * target_bones[(parent, child)]
    )


def _combat_guard_anchor(base, index, target_bones, optimization_context):
    """Build a feasible directional seed; scalar angles alone cannot choose a guard plane."""
    guard = base.copy()
    _place(guard, index, target_bones, "shoulder_left", "elbow_left", (-0.35, -0.65, 0.25))
    _place(guard, index, target_bones, "elbow_left", "wrist_left", (0.30, 0.75, 0.30))
    _place(guard, index, target_bones, "shoulder_right", "elbow_right", (0.35, -0.65, 0.25))
    _place(guard, index, target_bones, "elbow_right", "wrist_right", (-0.30, 0.75, 0.30))
    _place(guard, index, target_bones, "hip_left", "knee_left", (-0.20, -0.94, 0.28))
    _place(guard, index, target_bones, "knee_left", "ankle_left", (0.10, -0.96, 0.25))
    _place(guard, index, target_bones, "ankle_left", "foot_left", (0.0, -0.25, 0.97))
    _place(guard, index, target_bones, "hip_right", "knee_right", (0.20, -0.94, -0.28))
    _place(guard, index, target_bones, "knee_right", "ankle_right", (-0.10, -0.96, -0.25))
    _place(guard, index, target_bones, "ankle_right", "foot_right", (0.0, -0.25, 0.97))

    exempt = set((optimization_context or {}).get("guard_exempt_variables") or [])
    for side in ("left", "right"):
        if exempt & {f"{side}_shoulder_angle", f"{side}_elbow_flexion"}:
            guard[index[f"elbow_{side}"]] = base[index[f"elbow_{side}"]]
            guard[index[f"wrist_{side}"]] = base[index[f"wrist_{side}"]]
        elif exempt & {f"{side}_hand_head_distance", f"{side}_hand_head_height"}:
            guard[index[f"wrist_{side}"]] = base[index[f"wrist_{side}"]]
    return guard


def _variable_residual(actual, target, variable_id):
    definition = VARIABLE_DEFINITIONS[variable_id]
    difference = _angle_delta(actual, target) if definition.group == "orientation" else actual - target
    scale = 5.0 if definition.unit == "degrees" else 0.08
    return difference / scale


def reconstruct_pose(target_variables, pose_a, pose_b, max_evaluations=1200, optimization_context=None):
    """Solve one complete landmark skeleton for a jointly optimized variable vector."""
    missing = sorted(set(VARIABLE_DEFINITIONS) - set(target_variables))
    if missing:
        raise HTTPException(400, f"Optimized pose is missing variables: {', '.join(missing)}")

    first = _pose_array(pose_a)
    second = _pose_array(pose_b)
    base = (first + second) / 2
    index = {name: position for position, name in enumerate(LANDMARK_ORDER)}
    target_bones = {
        (start, end): (
            np.linalg.norm(first[index[start]] - first[index[end]])
            + np.linalg.norm(second[index[start]] - second[index[end]])
        ) / 2
        for start, end in POSE_BONES
    }
    anchor = (
        _combat_guard_anchor(base, index, target_bones, optimization_context)
        if (optimization_context or {}).get("anchor_mode") == "combat_guard"
        else base
    )
    initial = anchor.copy()

    def residual(flattened):
        landmark_map = _landmarks(flattened)
        try:
            actual_variables = extract_pose_variables({"landmarks": landmark_map})
        except ValueError:
            return np.full(len(VARIABLE_DEFINITIONS) + len(POSE_BONES) + 3 + len(flattened), 1_000.0)
        variable_errors = [
            _variable_residual(actual_variables[variable_id], target_variables[variable_id], variable_id)
            for variable_id in VARIABLE_DEFINITIONS
        ]
        matrix = np.asarray(flattened).reshape((len(LANDMARK_ORDER), 3))
        bone_errors = [
            (np.linalg.norm(matrix[index[start]] - matrix[index[end]]) - target_bones[(start, end)]) / 0.01
            for start, end in POSE_BONES
        ]
        hip_center = (matrix[index["hip_left"]] + matrix[index["hip_right"]]) / 2
        anchor_errors = (hip_center / 0.01).tolist()
        regularization_scale = 0.12 if (optimization_context or {}).get("anchor_mode") == "combat_guard" else 0.5
        regularization = ((matrix - anchor) / regularization_scale).ravel().tolist()
        return np.array(variable_errors + bone_errors + anchor_errors + regularization)

    result = least_squares(
        residual,
        initial.ravel(),
        bounds=(-5.0, 5.0),
        method="trf",
        max_nfev=max_evaluations,
        ftol=1e-10,
        xtol=1e-10,
        gtol=1e-10,
    )
    tolerance = (float(pose_a.get("tolerance", 0.12)) + float(pose_b.get("tolerance", 0.12))) / 2
    reconstructed = normalize_reference_pose({
        "schema_version": "1.0",
        "coordinate_space": "body_normalized_v1",
        "tolerance": tolerance,
        "landmarks": _landmarks(result.x),
    }, "optimization", "representative pose")
    actual_variables = extract_pose_variables(reconstructed)
    variable_errors = {}
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        error = abs(_angle_delta(actual_variables[variable_id], target_variables[variable_id])) if definition.group == "orientation" else abs(actual_variables[variable_id] - target_variables[variable_id])
        limit = ANGLE_ERROR_LIMIT if definition.unit == "degrees" else POSITION_ERROR_LIMIT
        variable_errors[variable_id] = {
            "target": round(float(target_variables[variable_id]), 6),
            "actual": actual_variables[variable_id],
            "absolute_error": round(error, 6),
            "within_tolerance": error <= limit,
        }

    bone_errors = []
    for bone in reconstructed["bones"]:
        target = target_bones[(bone["from"], bone["to"])]
        relative_error = abs(bone["length"] - target) / max(target, 1e-9)
        bone_errors.append(relative_error)
    variable_feasible = all(item["within_tolerance"] for item in variable_errors.values())
    max_bone_error = max(bone_errors, default=0.0)
    normalized_projection_errors = []
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        limit = ANGLE_ERROR_LIMIT if definition.unit == "degrees" else POSITION_ERROR_LIMIT
        normalized_projection_errors.append(variable_errors[variable_id]["absolute_error"] / limit)
    projection_rmse = (
        sum(error ** 2 for error in normalized_projection_errors) / len(normalized_projection_errors)
    ) ** 0.5
    physical_feasible = bool(np.all(np.isfinite(result.x)) and max_bone_error <= BONE_RELATIVE_ERROR_LIMIT)
    anchor_rmse = float(np.sqrt(np.mean(np.sum((np.asarray(result.x).reshape((-1, 3)) - anchor) ** 2, axis=1))))

    return {
        "schema_version": "1.0",
        "kinematics_version": KINEMATICS_VERSION,
        "feasible": physical_feasible,
        "target_within_tolerance": variable_feasible,
        "projected": not variable_feasible,
        "projection_rmse": round(float(projection_rmse), 8),
        "solver_success": bool(result.success),
        "solver_status": int(result.status),
        "solver_evaluations": int(result.nfev),
        "cost": round(float(result.cost), 8),
        "max_bone_relative_error": round(max_bone_error, 8),
        "visual_anchor_rmse": round(anchor_rmse, 8),
        "variable_errors": variable_errors,
        "actual_variables": actual_variables,
        "reference_pose": reconstructed,
    }
