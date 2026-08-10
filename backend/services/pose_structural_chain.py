"""Deterministic structural-chain measurements for a static pose vector.

The measurements in this module are geometric heuristics. They describe how
well the arm and torso segments are arranged to support one another; they do
not estimate force transfer, muscle activation, or other dynamic mechanics.
"""

from math import exp

from services.pose_variables import VARIABLE_DEFINITIONS


STRUCTURAL_CHAIN_VERSION = "1.0.0"


def _clamp(value):
    return max(0.0, min(1.0, value))


def _inside(value, ideal_minimum, ideal_maximum, falloff):
    if ideal_minimum <= value <= ideal_maximum:
        return 1.0
    distance = ideal_minimum - value if value < ideal_minimum else value - ideal_maximum
    return _clamp(1.0 - distance / falloff)


def _average(*values):
    return sum(values) / len(values) if values else 0.0


def _angular_difference(first, second):
    difference = abs(first - second) % 360
    return min(difference, 360 - difference)


def _joint_reserve(variable_id, value):
    definition = VARIABLE_DEFINITIONS[variable_id]
    half_width = (definition.constraint_max - definition.constraint_min) / 2
    if half_width <= 0:
        return 0.0
    normalized = min(value - definition.constraint_min, definition.constraint_max - value) / half_width
    # A saturating curve rewards usable reserve without requiring the joint to
    # sit at the exact center of its broad anatomical envelope.
    return _clamp(1.0 - exp(-4 * max(0.0, normalized)))


def evaluate_structural_chain(variables):
    """Return normalized, optimizer-safe structural-chain components.

    Wrist placement is represented by guard height and guard width because the
    generalized decision vector intentionally contains body-normalized pose
    variables rather than raw landmarks.
    """
    arm_connections = {}
    arm_reserves = {}
    for side in ("left", "right"):
        shoulder_id = f"{side}_shoulder_angle"
        elbow_id = f"{side}_elbow_flexion"
        shoulder_connection = _inside(variables[shoulder_id], 15, 110, 55)
        elbow_connection = _inside(variables[elbow_id], 40, 130, 50)
        arm_connections[side] = _average(shoulder_connection, elbow_connection)
        arm_reserves[side] = _average(
            _joint_reserve(shoulder_id, variables[shoulder_id]),
            _joint_reserve(elbow_id, variables[elbow_id]),
        )

    arm_connection = _average(*arm_connections.values())
    arm_chain_reserve = _average(*arm_reserves.values())
    guard_compactness = _average(
        _inside(variables["guard_height"], 0.45, 1.30, 0.90),
        _inside(variables["guard_width"], 0.25, 1.15, 1.00),
        arm_connection,
    )

    shoulder_pelvis_separation = _angular_difference(
        variables["shoulder_rotation"], variables["pelvis_rotation"]
    )
    torso_stack = _average(
        _inside(variables["torso_lean"], 0, 25, 40),
        _inside(shoulder_pelvis_separation, 0, 40, 50),
    )
    lower_body_support = _average(
        _inside(variables["stance_width"], 0.55, 1.55, 0.80),
        _inside(variables["stance_depth"], 0.15, 1.45, 0.90),
        _inside(variables["left_knee_flexion"], 90, 170, 60),
        _inside(variables["right_knee_flexion"], 90, 170, 60),
        _inside(variables["left_ankle_angle"], 55, 135, 55),
        _inside(variables["right_ankle_angle"], 55, 135, 55),
    )
    torso_support = _average(torso_stack, lower_body_support)
    whole_body_support = _average(arm_connection, torso_stack, lower_body_support)
    joint_chain_safety = _average(arm_chain_reserve, torso_stack, lower_body_support)

    return {
        "version": STRUCTURAL_CHAIN_VERSION,
        "scope": "static_geometry_heuristic",
        "components": {
            "left_arm_connection": arm_connections["left"],
            "right_arm_connection": arm_connections["right"],
            "arm_connection": arm_connection,
            "guard_compactness": guard_compactness,
            "torso_stack": torso_stack,
            "lower_body_support": lower_body_support,
            "torso_support": torso_support,
            "whole_body_support": whole_body_support,
            "arm_chain_reserve": arm_chain_reserve,
            "joint_chain_safety": joint_chain_safety,
        },
    }
