import unittest

from fastapi import HTTPException

from services.pose_optimization_schema import (
    DEFAULT_OBJECTIVE_WEIGHTS,
    POSE_LANDMARKS,
    normalize_reference_pose,
    validate_pose_optimization,
)


def reference_pose(offset=0.0):
    landmarks = {
        name: [offset + index * 0.01, index * 0.02, index * -0.01]
        for index, name in enumerate(sorted(POSE_LANDMARKS))
    }
    return {
        "coordinate_space": "body_normalized_v1",
        "tolerance": 0.12,
        "landmarks": landmarks,
    }


class PoseOptimizationSchemaTests(unittest.TestCase):
    def test_face_and_hand_articulation_survives_normalization(self):
        pose = reference_pose()
        pose["articulation"] = {
            "face": {"gaze_horizontal": -0.4, "eye_openness": 0.7, "jaw_openness": 0.2},
            "hand_left": {"fist_closure": 0.85, "finger_spread": 0.1},
            "hand_right": {"fist_closure": 0.15, "finger_spread": 0.6},
        }

        result = normalize_reference_pose(pose, 1)

        self.assertEqual(result["articulation"]["face"]["gaze_horizontal"], -0.4)
        self.assertEqual(result["articulation"]["face"]["eye_openness"], 0.7)
        self.assertEqual(result["articulation"]["hand_left"]["fist_closure"], 0.85)
        self.assertEqual(result["articulation"]["hand_right"]["finger_spread"], 0.6)

    def test_draft_accepts_one_endpoint_and_applies_reproducible_defaults(self):
        result = validate_pose_optimization({"pose_a": reference_pose()}, 1)

        self.assertEqual(result["status"], "DRAFT")
        self.assertEqual(result["seed"], 42)
        self.assertEqual(result["margin"], {"angle_degrees": 0.0, "position_normalized": 0.0})
        self.assertEqual(result["objective_weights"], DEFAULT_OBJECTIVE_WEIGHTS)
        self.assertEqual(result["optimization_context"]["anchor_mode"], "none")
        self.assertEqual(result["pose_a"]["origin"], "hip_center")
        self.assertEqual(len(result["pose_a"]["bones"]), 16)

    def test_ready_requires_two_complete_reference_poses(self):
        with self.assertRaisesRegex(HTTPException, "both Pose A and Pose B"):
            validate_pose_optimization({"status": "READY", "pose_a": reference_pose()}, 2)

        result = validate_pose_optimization({
            "status": "READY",
            "pose_a": reference_pose(),
            "pose_b": reference_pose(0.05),
        }, 2)
        self.assertEqual(result["status"], "READY")

    def test_margin_and_objective_limits_are_enforced(self):
        with self.assertRaisesRegex(HTTPException, "angle margin"):
            validate_pose_optimization({"margin": {"angle_degrees": 31}}, 1)
        with self.assertRaisesRegex(HTTPException, "unknown optimization objectives"):
            validate_pose_optimization({"objective_weights": {"magic": 1}}, 1)
        with self.assertRaisesRegex(HTTPException, "must be between 0 and 10"):
            validate_pose_optimization({"objective_weights": {"joint_safety": 11}}, 1)

    def test_position_margin_has_no_artificial_upper_limit(self):
        result = validate_pose_optimization({"margin": {"position_normalized": 5.0}}, 1)
        self.assertEqual(result["margin"]["position_normalized"], 5.0)

        with self.assertRaisesRegex(HTTPException, "finite non-negative"):
            validate_pose_optimization({"margin": {"position_normalized": -0.01}}, 1)

    def test_existing_result_fields_survive_normalization(self):
        result = validate_pose_optimization({
            "status": "COMPLETED",
            "pose_a": reference_pose(),
            "pose_b": reference_pose(0.05),
            "representative_scores": {"joint_safety": 0.9},
        }, 1)
        self.assertEqual(result["representative_scores"]["joint_safety"], 0.9)

    def test_guard_context_validates_exempt_and_locked_variables(self):
        result = validate_pose_optimization({"optimization_context": {
            "anchor_mode": "combat_guard",
            "full_safe_ranges": True,
            "guard_exempt_variables": ["left_elbow_flexion", "left_hand_head_distance"],
            "range_locked_variables": ["left_elbow_flexion", "left_hand_head_distance"],
        }}, 1)
        self.assertEqual(result["optimization_context"]["anchor_mode"], "combat_guard")
        self.assertTrue(result["optimization_context"]["full_safe_ranges"])
        with self.assertRaisesRegex(HTTPException, "unknown pose variables"):
            validate_pose_optimization({"optimization_context": {
                "guard_exempt_variables": ["imaginary_joint"],
            }}, 1)


if __name__ == "__main__":
    unittest.main()
