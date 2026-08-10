import unittest

from services.pose_guard_anchor import evaluate_guard_similarity
from services.pose_biomechanics import evaluate_variables


GUARD = {
    "left_elbow_flexion": 85, "right_elbow_flexion": 85,
    "left_shoulder_angle": 60, "right_shoulder_angle": 60,
    "left_hip_angle": 140, "right_hip_angle": 140,
    "left_knee_flexion": 140, "right_knee_flexion": 140,
    "left_ankle_angle": 100, "right_ankle_angle": 100,
    "torso_lean": 8, "pelvis_rotation": -15, "shoulder_rotation": 15,
    "stance_width": 1.0, "stance_depth": 0.7,
    "guard_width": 0.7, "guard_height": 0.85,
    "left_hand_head_distance": 0.5, "right_hand_head_distance": 0.5,
    "left_hand_head_height": -0.45, "right_hand_head_height": -0.45,
}


class PoseGuardAnchorTests(unittest.TestCase):
    def test_guard_pose_scores_maximum(self):
        result = evaluate_guard_similarity(GUARD, {"anchor_mode": "combat_guard"})
        self.assertTrue(result["enabled"])
        self.assertEqual(result["score"], 1.0)

    def test_jab_arm_exception_preserves_rear_hand_guard_measurement(self):
        jab = dict(GUARD)
        jab.update({
            "left_elbow_flexion": 175,
            "left_shoulder_angle": 150,
            "left_hand_head_distance": 2.2,
            "left_hand_head_height": -1.8,
        })
        unmodified = evaluate_guard_similarity(jab, {"anchor_mode": "combat_guard"})
        exempt = evaluate_guard_similarity(jab, {
            "anchor_mode": "combat_guard",
            "guard_exempt_variables": [
                "left_elbow_flexion", "left_shoulder_angle", "left_hand_head_distance",
                "left_hand_head_height",
            ],
        })
        self.assertGreater(exempt["score"], unmodified["score"])
        self.assertNotIn("left_hand_head_distance", exempt["components"])
        self.assertIn("right_hand_head_distance", exempt["components"])
        self.assertEqual(exempt["components"]["right_hand_head_distance"], 1.0)
        evaluation = evaluate_variables(jab, {
            "anchor_mode": "combat_guard",
            "guard_exempt_variables": [
                "left_elbow_flexion", "left_shoulder_angle", "left_hand_head_distance",
                "left_hand_head_height",
            ],
        })
        defense = evaluation["targets"]["defense"]
        self.assertGreaterEqual(defense["score"], 99)
        self.assertNotIn("guard_width", defense["components"])
        self.assertEqual(evaluation["targets"]["guard_similarity"]["score"], 100)

    def test_dropped_hands_cannot_be_hidden_by_good_lower_body_scores(self):
        dropped = dict(GUARD)
        dropped.update({
            "left_hand_head_distance": 2.5, "right_hand_head_distance": 2.5,
            "left_hand_head_height": -2.2, "right_hand_head_height": -2.2,
            "guard_height": -0.2,
        })
        result = evaluate_guard_similarity(dropped, {"anchor_mode": "combat_guard"})
        self.assertLess(result["score"], 0.55)


if __name__ == "__main__":
    unittest.main()
