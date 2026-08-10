"""Convert body-normalized landmarks into coupled static-pose variables."""

from dataclasses import dataclass
from math import acos, atan2, degrees, sqrt


@dataclass(frozen=True)
class PoseVariableDefinition:
    id: str
    label: str
    unit: str
    constraint_min: float
    constraint_max: float
    group: str


ANGLE_JOINTS = {
    "left_elbow_flexion": ("shoulder_left", "elbow_left", "wrist_left"),
    "right_elbow_flexion": ("shoulder_right", "elbow_right", "wrist_right"),
    "left_shoulder_angle": ("elbow_left", "shoulder_left", "hip_left"),
    "right_shoulder_angle": ("elbow_right", "shoulder_right", "hip_right"),
    "left_hip_angle": ("shoulder_left", "hip_left", "knee_left"),
    "right_hip_angle": ("shoulder_right", "hip_right", "knee_right"),
    "left_knee_flexion": ("hip_left", "knee_left", "ankle_left"),
    "right_knee_flexion": ("hip_right", "knee_right", "ankle_right"),
    "left_ankle_angle": ("knee_left", "ankle_left", "foot_left"),
    "right_ankle_angle": ("knee_right", "ankle_right", "foot_right"),
}


VARIABLE_DEFINITIONS = {
    definition.id: definition for definition in (
        PoseVariableDefinition("left_elbow_flexion", "Left elbow", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("right_elbow_flexion", "Right elbow", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("left_shoulder_angle", "Left shoulder", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("right_shoulder_angle", "Right shoulder", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("left_hip_angle", "Left hip", "degrees", 15, 180, "joint_angle"),
        PoseVariableDefinition("right_hip_angle", "Right hip", "degrees", 15, 180, "joint_angle"),
        PoseVariableDefinition("left_knee_flexion", "Left knee", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("right_knee_flexion", "Right knee", "degrees", 5, 180, "joint_angle"),
        PoseVariableDefinition("left_ankle_angle", "Left ankle", "degrees", 20, 170, "joint_angle"),
        PoseVariableDefinition("right_ankle_angle", "Right ankle", "degrees", 20, 170, "joint_angle"),
        PoseVariableDefinition("torso_lean", "Torso lean", "degrees", 0, 70, "orientation"),
        PoseVariableDefinition("pelvis_rotation", "Pelvis rotation", "degrees", -90, 90, "orientation"),
        PoseVariableDefinition("shoulder_rotation", "Shoulder rotation", "degrees", -90, 90, "orientation"),
        PoseVariableDefinition("stance_width", "Stance width", "torso_lengths", 0.1, 3.0, "stance"),
        PoseVariableDefinition("stance_depth", "Stance depth", "torso_lengths", 0, 3.0, "stance"),
        PoseVariableDefinition("guard_width", "Guard width", "torso_lengths", 0.05, 3.0, "guard"),
        PoseVariableDefinition("guard_height", "Guard height", "torso_lengths", -1.5, 2.5, "guard"),
        PoseVariableDefinition("left_hand_head_distance", "Left hand to head", "torso_lengths", 0.05, 3.5, "guard"),
        PoseVariableDefinition("right_hand_head_distance", "Right hand to head", "torso_lengths", 0.05, 3.5, "guard"),
        PoseVariableDefinition("left_hand_head_height", "Left hand height from head", "torso_lengths", -3.5, 1.5, "guard"),
        PoseVariableDefinition("right_hand_head_height", "Right hand height from head", "torso_lengths", -3.5, 1.5, "guard"),
    )
}


def _subtract(first, second):
    return [first[index] - second[index] for index in range(3)]


def _length(vector):
    return sqrt(sum(value * value for value in vector))


def _center(first, second):
    return [(first[index] + second[index]) / 2 for index in range(3)]


def _angle(first, center, last):
    left = _subtract(first, center)
    right = _subtract(last, center)
    denominator = _length(left) * _length(right)
    if denominator <= 1e-12:
        raise ValueError("Cannot calculate an angle from coincident landmarks")
    cosine = max(-1.0, min(1.0, sum(left[index] * right[index] for index in range(3)) / denominator))
    return degrees(acos(cosine))


def _horizontal_rotation(left, right):
    direction = _subtract(right, left)
    return degrees(atan2(direction[2], direction[0]))


def extract_pose_variables(reference_pose):
    """Return the deterministic generalized variable vector for one pose."""
    landmarks = reference_pose["landmarks"]
    variables = {
        variable_id: _angle(landmarks[first], landmarks[center], landmarks[last])
        for variable_id, (first, center, last) in ANGLE_JOINTS.items()
    }
    hip_center = _center(landmarks["hip_left"], landmarks["hip_right"])
    shoulder_center = _center(landmarks["shoulder_left"], landmarks["shoulder_right"])
    torso = _subtract(shoulder_center, hip_center)
    torso_length = _length(torso)
    if torso_length <= 1e-12:
        raise ValueError("Hip and shoulder centers cannot coincide")
    vertical_cosine = max(-1.0, min(1.0, torso[1] / torso_length))
    wrist_center = _center(landmarks["wrist_left"], landmarks["wrist_right"])

    variables.update({
        "torso_lean": degrees(acos(vertical_cosine)),
        "pelvis_rotation": _horizontal_rotation(landmarks["hip_left"], landmarks["hip_right"]),
        "shoulder_rotation": _horizontal_rotation(landmarks["shoulder_left"], landmarks["shoulder_right"]),
        "stance_width": abs(landmarks["ankle_right"][0] - landmarks["ankle_left"][0]) / torso_length,
        "stance_depth": abs(landmarks["ankle_right"][2] - landmarks["ankle_left"][2]) / torso_length,
        "guard_width": _length(_subtract(landmarks["wrist_right"], landmarks["wrist_left"])) / torso_length,
        "guard_height": (wrist_center[1] - hip_center[1]) / torso_length,
        "left_hand_head_distance": _length(_subtract(landmarks["wrist_left"], landmarks["head"])) / torso_length,
        "right_hand_head_distance": _length(_subtract(landmarks["wrist_right"], landmarks["head"])) / torso_length,
        "left_hand_head_height": (landmarks["wrist_left"][1] - landmarks["head"][1]) / torso_length,
        "right_hand_head_height": (landmarks["wrist_right"][1] - landmarks["head"][1]) / torso_length,
    })
    return {key: round(value, 6) for key, value in variables.items()}
