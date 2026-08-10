"""Deterministic static-pose biomechanics and martial-readiness proxies.

These scores describe geometry only. They do not claim to measure force,
momentum, energy expenditure, or dynamic balance from a static skeleton.
"""

from math import exp

from fastapi import HTTPException

from services.pose_constraints import evaluate_constraint_violations
from services.pose_guard_anchor import GUARD_ANCHOR_VERSION, evaluate_guard_similarity
from services.pose_structural_chain import STRUCTURAL_CHAIN_VERSION, evaluate_structural_chain
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


EVALUATOR_VERSION = "1.2.0"
TARGET_KINDS = {
    "energy_efficiency_proxy": "heuristic_proxy",
    "static_stability": "geometry_estimate",
    "defense": "heuristic_proxy",
    "readiness": "heuristic_proxy",
    "power_potential_proxy": "heuristic_proxy",
    "mobility": "geometry_estimate",
    "structural_efficiency": "geometry_estimate",
    "joint_safety": "constraint_estimate",
    "guard_similarity": "reference_geometry",
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


def evaluate_pose(reference_pose, optimization_context=None):
    """Evaluate one normalized skeleton and return scores with transparent evidence."""
    try:
        variables = extract_pose_variables(reference_pose)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(400, f"Cannot evaluate pose: {error}") from None

    return evaluate_variables(variables, optimization_context)


def evaluate_variables(variables, optimization_context=None):
    """Evaluate one complete generalized skeleton vector."""

    violations = evaluate_constraint_violations(variables)
    violation_variables = {item["variable"] for item in violations}
    joint_ids = [variable_id for variable_id, definition in VARIABLE_DEFINITIONS.items() if definition.group == "joint_angle"]
    safety_components = {
        variable_id: 0.0 if variable_id in violation_variables else _safety_reserve(variable_id, variables[variable_id])
        for variable_id in joint_ids
    }
    safety = _average(*safety_components.values())
    structural_chain = evaluate_structural_chain(variables)
    chain = structural_chain["components"]
    guard_anchor = evaluate_guard_similarity(variables, optimization_context)
    guard_exempt = set((optimization_context or {}).get("guard_exempt_variables") or [])
    active_guard_sides = [
        side for side in ("left", "right")
        if not guard_exempt & {
            f"{side}_elbow_flexion", f"{side}_shoulder_angle",
            f"{side}_hand_head_distance", f"{side}_hand_head_height"
        }
    ]

    stance_width = _inside(variables["stance_width"], 0.65, 1.45, 0.75)
    stance_depth = _inside(variables["stance_depth"], 0.25, 1.35, 0.8)
    torso_control = _inside(variables["torso_lean"], 0, 18, 35)
    knee_symmetry = _symmetry(variables["left_knee_flexion"], variables["right_knee_flexion"], 55)
    stability = _average(stance_width, stance_depth, torso_control, knee_symmetry)

    guard_height = _inside(variables["guard_height"], 0.45, 1.2, 0.8)
    guard_width = _inside(variables["guard_width"], 0.25, 1.05, 1.0)
    elbow_guard_by_side = {
        side: _inside(variables[f"{side}_elbow_flexion"], 45, 125, 55)
        for side in active_guard_sides
    }
    elbow_guard = _average(*elbow_guard_by_side.values()) if elbow_guard_by_side else 1.0
    active_arm_connection = _average(*(
        chain[f"{side}_arm_connection"] for side in active_guard_sides
    )) if active_guard_sides else 1.0
    defense_values = [elbow_guard, active_arm_connection]
    hand_is_exempt = bool(guard_exempt & {"left_hand_head_distance", "right_hand_head_distance"})
    if not hand_is_exempt:
        defense_values.extend((guard_height, guard_width, chain["guard_compactness"]))
    defense = _average(*defense_values)

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
    structural_values = [torso_control, knee_symmetry, active_arm_connection, chain["torso_support"]]
    if not guard_exempt & {"left_shoulder_angle", "right_shoulder_angle"}:
        structural_values.append(shoulder_symmetry)
    if not guard_exempt & {"left_hip_angle", "right_hip_angle"}:
        structural_values.append(hip_symmetry)
    structural = _average(*structural_values)
    safety = _average(safety, chain["joint_chain_safety"])

    compactness_values = [_inside(variables["torso_lean"], 0, 25, 35), safety]
    if not hand_is_exempt:
        compactness_values.append(_inside(variables["guard_width"], 0.25, 1.2, 1.0))
    compactness = _average(*compactness_values)
    energy_proxy = _average(compactness, structural, stability)
    readiness = _average(stability, defense, mobility, structural, chain["whole_body_support"])

    raw = {
        "energy_efficiency_proxy": energy_proxy,
        "static_stability": stability,
        "defense": defense,
        "readiness": readiness,
        "power_potential_proxy": power_proxy,
        "mobility": mobility,
        "structural_efficiency": structural,
        "joint_safety": safety,
        "guard_similarity": guard_anchor["score"],
    }
    components = {
        "energy_efficiency_proxy": {"compactness": _score(compactness), "structure": _score(structural), "stability": _score(stability)},
        "static_stability": {"stance_width": _score(stance_width), "stance_depth": _score(stance_depth), "torso_control": _score(torso_control), "knee_symmetry": _score(knee_symmetry)},
        "defense": {"elbow_guard": _score(elbow_guard), "chain_arm_connection": _score(active_arm_connection), **({} if hand_is_exempt else {"guard_height": _score(guard_height), "guard_width": _score(guard_width), "chain_guard_compactness": _score(chain["guard_compactness"])})},
        "readiness": {"stability": _score(stability), "defense": _score(defense), "mobility": _score(mobility), "structure": _score(structural), "chain_whole_body_support": _score(chain["whole_body_support"])},
        "power_potential_proxy": {"rotational_loading": _score(rotational_loading), "leg_loading": _score(leg_loading), "stance_depth": _score(stance_depth)},
        "mobility": {key: _score(value) for key, value in mobility_components.items()},
        "structural_efficiency": {"torso_control": _score(torso_control), "knee_symmetry": _score(knee_symmetry), **({} if guard_exempt & {"left_shoulder_angle", "right_shoulder_angle"} else {"shoulder_symmetry": _score(shoulder_symmetry)}), **({} if guard_exempt & {"left_hip_angle", "right_hip_angle"} else {"hip_symmetry": _score(hip_symmetry)}), "chain_arm_connection": _score(active_arm_connection), "chain_torso_support": _score(chain["torso_support"])},
        "joint_safety": {**{key: _score(value) for key, value in safety_components.items()}, "chain_joint_safety": _score(chain["joint_chain_safety"])},
        "guard_similarity": {
            key: _score(value) for key, value in guard_anchor["components"].items()
        } or {"anchor_disabled": 100.0},
    }
    return {
        "schema_version": "1.0",
        "evaluator_version": EVALUATOR_VERSION,
        "structural_chain_version": STRUCTURAL_CHAIN_VERSION,
        "guard_anchor_version": GUARD_ANCHOR_VERSION,
        "optimization_context": optimization_context or {"anchor_mode": "none"},
        "evaluation_scope": "static_geometry",
        "valid": not violations,
        "variables": variables,
        "constraint_violations": violations,
        "targets": {
            target: {"score": _score(value), "kind": TARGET_KINDS[target], "components": components[target]}
            for target, value in raw.items()
        },
    }
