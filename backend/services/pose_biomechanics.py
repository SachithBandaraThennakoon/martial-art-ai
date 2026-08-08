"""Deterministic static-pose biomechanics and martial-readiness proxies.

These scores describe geometry only. They do not claim to measure force,
momentum, energy expenditure, or dynamic balance from a static skeleton.
"""

from math import exp

from fastapi import HTTPException

from services.pose_constraints import evaluate_constraint_violations
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


EVALUATOR_VERSION = "1.0.0"
TARGET_KINDS = {
    "energy_efficiency_proxy": "heuristic_proxy",
    "static_stability": "geometry_estimate",
    "defense": "heuristic_proxy",
    "readiness": "heuristic_proxy",
    "power_potential_proxy": "heuristic_proxy",
    "mobility": "geometry_estimate",
    "structural_efficiency": "geometry_estimate",
    "joint_safety": "constraint_estimate",
}


def _clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, value))


def _near(value, ideal, tolerance):
    return _clamp(1.0 - abs(value - ideal) / tolerance)


def _inside(value, ideal_minimum, ideal_maximum, falloff):
    if ideal_minimum <= value <= ideal_maximum:
        return 1.0
    distance = ideal_minimum - value if value < ideal_minimum else value - ideal_maximum
    return _clamp(1.0 - distance / falloff)


def _symmetry(first, second, tolerance):
    return _clamp(1.0 - abs(first - second) / tolerance)


def _average(*values):
    return sum(values) / len(values) if values else 0.0


def _angular_difference(first, second):
    difference = abs(first - second) % 360
    return min(difference, 360 - difference)


def _safety_reserve(variable_id, value):
    definition = VARIABLE_DEFINITIONS[variable_id]
    half_width = (definition.constraint_max - definition.constraint_min) / 2
    if half_width <= 0:
        return 0.0
    return _clamp(min(value - definition.constraint_min, definition.constraint_max - value) / half_width)


def _score(value):
    return round(_clamp(value) * 100, 2)


def evaluate_pose(reference_pose):
    """Evaluate one normalized skeleton and return scores with transparent evidence."""
    try:
        variables = extract_pose_variables(reference_pose)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(400, f"Cannot evaluate pose: {error}") from None

    return evaluate_variables(variables)


def evaluate_variables(variables):
    """Evaluate one complete generalized skeleton vector."""

    violations = evaluate_constraint_violations(variables)
    violation_variables = {item["variable"] for item in violations}
    joint_ids = [variable_id for variable_id, definition in VARIABLE_DEFINITIONS.items() if definition.group == "joint_angle"]
    safety_components = {
        variable_id: 0.0 if variable_id in violation_variables else _safety_reserve(variable_id, variables[variable_id])
        for variable_id in joint_ids
    }
    safety = _average(*safety_components.values())

    stance_width = _inside(variables["stance_width"], 0.65, 1.45, 0.75)
    stance_depth = _inside(variables["stance_depth"], 0.25, 1.35, 0.8)
    torso_control = _inside(variables["torso_lean"], 0, 18, 35)
    knee_symmetry = _symmetry(variables["left_knee_flexion"], variables["right_knee_flexion"], 55)
    stability = _average(stance_width, stance_depth, torso_control, knee_symmetry)

    guard_height = _inside(variables["guard_height"], 0.45, 1.2, 0.8)
    guard_width = _inside(variables["guard_width"], 0.25, 1.05, 1.0)
    elbow_guard = _average(
        _inside(variables["left_elbow_flexion"], 45, 125, 55),
        _inside(variables["right_elbow_flexion"], 45, 125, 55),
    )
    defense = _average(guard_height, guard_width, elbow_guard)

    hip_shoulder_separation = _angular_difference(variables["pelvis_rotation"], variables["shoulder_rotation"])
    rotational_loading = _inside(hip_shoulder_separation, 12, 45, 35)
    leg_loading = _average(
        _inside(variables["left_knee_flexion"], 105, 165, 55),
        _inside(variables["right_knee_flexion"], 105, 165, 55),
    )
    power_proxy = _average(rotational_loading, leg_loading, stance_depth)

    mobility_components = {
        variable_id: _clamp(1.0 - exp(-4 * _safety_reserve(variable_id, variables[variable_id])))
        for variable_id in joint_ids
    }
    mobility = _average(*mobility_components.values())

    shoulder_symmetry = _symmetry(variables["left_shoulder_angle"], variables["right_shoulder_angle"], 70)
    hip_symmetry = _symmetry(variables["left_hip_angle"], variables["right_hip_angle"], 55)
    structural = _average(torso_control, knee_symmetry, shoulder_symmetry, hip_symmetry)

    compactness = _average(
        _inside(variables["guard_width"], 0.25, 1.2, 1.0),
        _inside(variables["torso_lean"], 0, 25, 35),
        safety,
    )
    energy_proxy = _average(compactness, structural, stability)
    readiness = _average(stability, defense, mobility, structural)

    raw = {
        "energy_efficiency_proxy": energy_proxy,
        "static_stability": stability,
        "defense": defense,
        "readiness": readiness,
        "power_potential_proxy": power_proxy,
        "mobility": mobility,
        "structural_efficiency": structural,
        "joint_safety": safety,
    }
    components = {
        "energy_efficiency_proxy": {"compactness": _score(compactness), "structure": _score(structural), "stability": _score(stability)},
        "static_stability": {"stance_width": _score(stance_width), "stance_depth": _score(stance_depth), "torso_control": _score(torso_control), "knee_symmetry": _score(knee_symmetry)},
        "defense": {"guard_height": _score(guard_height), "guard_width": _score(guard_width), "elbow_guard": _score(elbow_guard)},
        "readiness": {"stability": _score(stability), "defense": _score(defense), "mobility": _score(mobility), "structure": _score(structural)},
        "power_potential_proxy": {"rotational_loading": _score(rotational_loading), "leg_loading": _score(leg_loading), "stance_depth": _score(stance_depth)},
        "mobility": {key: _score(value) for key, value in mobility_components.items()},
        "structural_efficiency": {"torso_control": _score(torso_control), "knee_symmetry": _score(knee_symmetry), "shoulder_symmetry": _score(shoulder_symmetry), "hip_symmetry": _score(hip_symmetry)},
        "joint_safety": {key: _score(value) for key, value in safety_components.items()},
    }
    return {
        "schema_version": "1.0",
        "evaluator_version": EVALUATOR_VERSION,
        "evaluation_scope": "static_geometry",
        "valid": not violations,
        "variables": variables,
        "constraint_violations": violations,
        "targets": {
            target: {"score": _score(value), "kind": TARGET_KINDS[target], "components": components[target]}
            for target, value in raw.items()
        },
    }
