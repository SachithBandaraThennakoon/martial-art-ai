import unittest

from services.pose_kinematics import KINEMATICS_VERSION, reconstruct_pose
from services.pose_optimization_schema import normalize_reference_pose
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


BASE = {
    "head": [0, 1.65, 0], "shoulder_left": [-0.52, 1.15, 0], "shoulder_right": [0.52, 1.15, 0],
    "elbow_left": [-0.84, 0.67, 0.02], "elbow_right": [0.84, 0.67, 0.02],
    "wrist_left": [-0.42, 0.9, 0.12], "wrist_right": [0.42, 0.9, 0.12],
    "hip_left": [-0.38, 0.1, -0.12], "hip_right": [0.38, 0.1, 0.12],
    "knee_left": [-0.5, -0.72, 0.18], "knee_right": [0.5, -0.72, -0.18],
    "ankle_left": [-0.58, -1.45, 0.38], "ankle_right": [0.58, -1.45, -0.38],
    "foot_left": [-0.58, -1.58, 0.72], "foot_right": [0.58, -1.58, -0.04],
}


def pose(landmarks=BASE):
    return normalize_reference_pose({"coordinate_space": "body_normalized_v1", "landmarks": landmarks}, 1)


class PoseKinematicsTests(unittest.TestCase):
    def test_reconstructs_complete_normalized_skeleton(self):
        anchor = pose()
        targets = extract_pose_variables(anchor)
        result = reconstruct_pose(targets, anchor, anchor, max_evaluations=400)
        self.assertEqual(result["kinematics_version"], KINEMATICS_VERSION)
        self.assertTrue(result["feasible"])
        self.assertTrue(result["target_within_tolerance"])
        self.assertFalse(result["projected"])
        self.assertEqual(set(result["actual_variables"]), set(VARIABLE_DEFINITIONS))
        self.assertEqual(result["reference_pose"]["coordinate_space"], "body_normalized_v1")
        self.assertEqual(len(result["reference_pose"]["bones"]), 16)

    def test_reconstruction_is_deterministic(self):
        anchor = pose()
        targets = extract_pose_variables(anchor)
        first = reconstruct_pose(targets, anchor, anchor, max_evaluations=400)
        second = reconstruct_pose(targets, anchor, anchor, max_evaluations=400)
        self.assertEqual(first, second)

    def test_reports_variable_fidelity(self):
        anchor = pose()
        targets = extract_pose_variables(anchor)
        targets["guard_height"] += 0.05
        result = reconstruct_pose(targets, anchor, anchor, max_evaluations=600)
        self.assertIn("guard_height", result["variable_errors"])
        self.assertLessEqual(result["variable_errors"]["guard_height"]["absolute_error"], 0.08)

    def test_combat_guard_context_resolves_limb_direction_ambiguity(self):
        anchor = pose()
        result = reconstruct_pose(
            extract_pose_variables(anchor), anchor, anchor, max_evaluations=600,
            optimization_context={"anchor_mode": "combat_guard", "guard_exempt_variables": []},
        )
        landmarks = result["reference_pose"]["landmarks"]
        self.assertLess(landmarks["elbow_left"][0], landmarks["shoulder_left"][0])
        self.assertGreater(landmarks["elbow_right"][0], landmarks["shoulder_right"][0])
        self.assertGreater(landmarks["wrist_left"][1], landmarks["elbow_left"][1])
        self.assertGreater(landmarks["wrist_right"][1], landmarks["elbow_right"][1])
        self.assertGreater(landmarks["wrist_left"][2], landmarks["shoulder_left"][2])
        self.assertGreater(landmarks["wrist_right"][2], landmarks["shoulder_right"][2])
        self.assertLess(result["visual_anchor_rmse"], 0.3)


if __name__ == "__main__":
    unittest.main()
