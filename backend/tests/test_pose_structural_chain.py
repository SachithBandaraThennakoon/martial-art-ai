import unittest

from services.pose_structural_chain import STRUCTURAL_CHAIN_VERSION, evaluate_structural_chain


SUPPORTED = {
    "left_elbow_flexion": 90, "right_elbow_flexion": 90,
    "left_shoulder_angle": 65, "right_shoulder_angle": 65,
    "left_hip_angle": 135, "right_hip_angle": 135,
    "left_knee_flexion": 135, "right_knee_flexion": 135,
    "left_ankle_angle": 95, "right_ankle_angle": 95,
    "torso_lean": 10, "pelvis_rotation": 10, "shoulder_rotation": 25,
    "stance_width": 1.0, "stance_depth": 0.7,
    "guard_width": 0.7, "guard_height": 0.8,
}


class PoseStructuralChainTests(unittest.TestCase):
    def test_returns_versioned_normalized_components_deterministically(self):
        first = evaluate_structural_chain(SUPPORTED)
        self.assertEqual(first, evaluate_structural_chain(SUPPORTED))
        self.assertEqual(first["version"], STRUCTURAL_CHAIN_VERSION)
        self.assertEqual(first["scope"], "static_geometry_heuristic")
        self.assertTrue(first["components"])
        for value in first["components"].values():
            self.assertGreaterEqual(value, 0)
            self.assertLessEqual(value, 1)

    def test_overextended_arm_reduces_connection_and_guard_chain(self):
        overextended = dict(SUPPORTED)
        overextended.update({
            "left_elbow_flexion": 178,
            "right_elbow_flexion": 178,
            "left_shoulder_angle": 175,
            "right_shoulder_angle": 175,
        })
        supported = evaluate_structural_chain(SUPPORTED)["components"]
        extended = evaluate_structural_chain(overextended)["components"]
        self.assertLess(extended["arm_connection"], supported["arm_connection"])
        self.assertLess(extended["guard_compactness"], supported["guard_compactness"])
        self.assertLess(extended["joint_chain_safety"], supported["joint_chain_safety"])

    def test_unstacked_torso_and_unsupported_legs_reduce_support(self):
        unsupported = dict(SUPPORTED)
        unsupported.update({
            "torso_lean": 68,
            "pelvis_rotation": -85,
            "shoulder_rotation": 85,
            "stance_width": 2.9,
            "stance_depth": 2.9,
            "left_knee_flexion": 8,
            "right_knee_flexion": 8,
            "left_ankle_angle": 165,
            "right_ankle_angle": 165,
        })
        supported = evaluate_structural_chain(SUPPORTED)["components"]
        weak = evaluate_structural_chain(unsupported)["components"]
        self.assertLess(weak["torso_stack"], supported["torso_stack"])
        self.assertLess(weak["lower_body_support"], supported["lower_body_support"])
        self.assertLess(weak["whole_body_support"], supported["whole_body_support"])


if __name__ == "__main__":
    unittest.main()
