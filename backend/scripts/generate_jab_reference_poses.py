import json
import math
from pathlib import Path

path = Path(__file__).resolve().parents[0] / "../data/techniques/jab/training-steps.json"
path = path.resolve()
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

pose = {
    'head': [0, 1.65, 0],
    'shoulder_left': [-0.52, 1.15, 0],
    'shoulder_right': [0.52, 1.15, 0],
    'elbow_left': [-0.84, 0.67, 0.02],
    'elbow_right': [0.84, 0.67, 0.02],
    'wrist_left': [-0.62, 0.18, 0.05],
    'wrist_right': [0.62, 0.18, 0.05],
    'hip_left': [-0.38, 0.1, 0],
    'hip_right': [0.38, 0.1, 0],
    'knee_left': [-0.43, -0.78, 0.04],
    'knee_right': [0.43, -0.78, 0.04],
    'ankle_left': [-0.39, -1.6, 0],
    'ankle_right': [0.39, -1.6, 0],
    'foot_left': [-0.42, -1.72, 0.35],
    'foot_right': [0.42, -1.72, 0.35],
}

links = [
    ('head', 'shoulder_left'), ('head', 'shoulder_right'),
    ('shoulder_left', 'shoulder_right'), ('shoulder_left', 'elbow_left'),
    ('elbow_left', 'wrist_left'), ('shoulder_right', 'elbow_right'),
    ('elbow_right', 'wrist_right'), ('shoulder_left', 'hip_left'),
    ('shoulder_right', 'hip_right'), ('hip_left', 'hip_right'),
    ('hip_left', 'knee_left'), ('knee_left', 'ankle_left'),
    ('ankle_left', 'foot_left'), ('hip_right', 'knee_right'),
    ('knee_right', 'ankle_right'), ('ankle_right', 'foot_right'),
]

angle_joints = {
    'elbow_left': ('shoulder_left', 'elbow_left', 'wrist_left'),
    'elbow_right': ('shoulder_right', 'elbow_right', 'wrist_right'),
    'shoulder_left': ('elbow_left', 'shoulder_left', 'hip_left'),
    'shoulder_right': ('elbow_right', 'shoulder_right', 'hip_right'),
    'hip_left': ('shoulder_left', 'hip_left', 'knee_left'),
    'hip_right': ('shoulder_right', 'hip_right', 'knee_right'),
    'knee_left': ('hip_left', 'knee_left', 'ankle_left'),
    'knee_right': ('hip_right', 'knee_right', 'ankle_right'),
    'ankle_left': ('knee_left', 'ankle_left', 'foot_left'),
    'ankle_right': ('knee_right', 'ankle_right', 'foot_right'),
}

parent_map = {
    'shoulder_left': 'head',
    'shoulder_right': 'head',
    'shoulder_right': 'shoulder_left',
    'elbow_left': 'shoulder_left',
    'wrist_left': 'elbow_left',
    'elbow_right': 'shoulder_right',
    'wrist_right': 'elbow_right',
    'hip_left': 'shoulder_left',
    'hip_right': 'shoulder_right',
    'hip_right': 'hip_left',
    'knee_left': 'hip_left',
    'ankle_left': 'knee_left',
    'foot_left': 'ankle_left',
    'knee_right': 'hip_right',
    'ankle_right': 'knee_right',
    'foot_right': 'ankle_right',
}


def calculate_angle(a, c, b):
    left = [a[i] - c[i] for i in range(3)]
    right = [b[i] - c[i] for i in range(3)]
    denom = math.hypot(*left) * math.hypot(*right)
    if denom == 0:
        return 0
    cosine = max(-1, min(1, sum(left[i] * right[i] for i in range(3)) / denom))
    return round(math.degrees(math.acos(cosine)))


def rotate_branch(pose, root, pivot, radians):
    next_pose = {k: [float(v[i]) for i in range(3)] for k, v in pose.items()}

    def rotate(joint):
        if joint not in next_pose:
            return
        x, y, z = next_pose[joint]
        px, py, pz = next_pose[pivot]
        dx, dy = x - px, y - py
        next_pose[joint] = [
            px + dx * math.cos(radians) - dy * math.sin(radians),
            py + dx * math.sin(radians) + dy * math.cos(radians),
            z,
        ]
        for child, parent in parent_map.items():
            if parent == joint:
                rotate(child)

    rotate(root)
    return next_pose


def pose_from_ranges(range_targets):
    current_pose = {k: list(v) for k, v in pose.items()}
    for target in range_targets:
        body_part = target.get('body_part')
        if body_part not in angle_joints:
            continue
        desired = float(target.get('target_angle', (target.get('min', 0) + target.get('max', 0)) / 2))
        first, center, last = angle_joints[body_part]
        for _ in range(48):
            current = calculate_angle(current_pose[first], current_pose[center], current_pose[last])
            if abs(desired - current) < 1:
                break
            positive = rotate_branch(current_pose, last, center, math.pi / 180 * 3)
            negative = rotate_branch(current_pose, last, center, -math.pi / 180 * 3)
            positive_error = abs(desired - calculate_angle(positive[first], positive[center], positive[last]))
            negative_error = abs(desired - calculate_angle(negative[first], negative[center], negative[last]))
            if positive_error < negative_error:
                current_pose = positive
            elif negative_error < positive_error:
                current_pose = negative
            else:
                break
    return current_pose


def normalize_pose(pose_dict):
    hip_center = [(pose_dict['hip_left'][i] + pose_dict['hip_right'][i]) / 2 for i in range(3)]
    shoulder_center = [(pose_dict['shoulder_left'][i] + pose_dict['shoulder_right'][i]) / 2 for i in range(3)]
    scale = math.hypot(*(shoulder_center[i] - hip_center[i] for i in range(3)))
    landmarks = {
        name: [round((position[i] - hip_center[i]) / scale, 4) for i in range(3)]
        for name, position in pose_dict.items()
    }
    bones = [
        {
            'from': a,
            'to': b,
            'length': round(math.dist(landmarks[a], landmarks[b]), 4),
        }
        for a, b in links
    ]
    return {
        'schema_version': '1.0',
        'coordinate_space': 'body_normalized_v1',
        'origin': 'hip_center',
        'scale_basis': 'torso_length',
        'tolerance': 0.12,
        'landmarks': landmarks,
        'bones': bones,
    }

for step in data.get('steps', []):
    pose_from_range = pose_from_ranges(step.get('angle_targets', []))
    step['reference_pose'] = normalize_pose(pose_from_range)

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print('Updated reference_pose for', len(data.get('steps', [])), 'steps in', path)
