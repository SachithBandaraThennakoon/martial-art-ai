import unittest

from services.pose_biomechanics import EVALUATOR_VERSION, TARGET_KINDS, evaluate_pose
from services.pose_optimization_schema import normalize_reference_pose


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
    return normalize_reference_pose({
        "coordinate_space": "body_normalized_v1",
        "landmarks": landmarks,
    }, 1)


class PoseBiomechanicsTests(unittest.TestCase):
    def test_returns_all_versioned_static_targets(self):
        result = evaluate_pose(pose())
        self.assertEqual(result["evaluator_version"], EVALUATOR_VERSION)
        self.assertEqual(result["evaluation_scope"], "static_geometry")
        self.assertEqual(set(result["targets"]), set(TARGET_KINDS))
        for target in result["targets"].values():
            self.assertGreaterEqual(target["score"], 0)
            self.assertLessEqual(target["score"], 100)
            self.assertTrue(target["components"])

    def test_evaluation_is_deterministic(self):
        self.assertEqual(evaluate_pose(pose()), evaluate_pose(pose()))

    def test_static_energy_and_power_are_explicit_proxies(self):
        targets = evaluate_pose(pose())["targets"]
        self.assertEqual(targets["energy_efficiency_proxy"]["kind"], "heuristic_proxy")
        self.assertEqual(targets["power_potential_proxy"]["kind"], "heuristic_proxy")

    def test_constraint_violation_marks_pose_invalid_and_reduces_safety(self):
        unsafe = {name: list(position) for name, position in BASE.items()}
        unsafe["foot_left"] = [-0.66, -2.18, 0.58]
        result = evaluate_pose(pose(unsafe))
        self.assertFalse(result["valid"])
        self.assertTrue(result["constraint_violations"])
        self.assertLess(result["targets"]["joint_safety"]["score"], 100)


if __name__ == "__main__":
    unittest.main()
