import unittest

from fastapi import HTTPException

from services.pose_optimization_schema import POSE_LANDMARKS, normalize_reference_pose
from services.pose_search_ranges import generate_search_ranges
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


BASE = {
    "head": [0, 1.65, 0], "shoulder_left": [-0.52, 1.15, 0], "shoulder_right": [0.52, 1.15, 0],
    "elbow_left": [-0.84, 0.67, 0.02], "elbow_right": [0.84, 0.67, 0.02],
    "wrist_left": [-0.62, 0.18, 0.05], "wrist_right": [0.62, 0.18, 0.05],
    "hip_left": [-0.38, 0.1, 0], "hip_right": [0.38, 0.1, 0],
    "knee_left": [-0.43, -0.78, 0.04], "knee_right": [0.43, -0.78, 0.04],
    "ankle_left": [-0.39, -1.6, 0], "ankle_right": [0.39, -1.6, 0],
    "foot_left": [-0.42, -1.72, 0.35], "foot_right": [0.42, -1.72, 0.35],
}


def pose(landmarks):
    assert set(landmarks) == POSE_LANDMARKS
    return normalize_reference_pose({
        "coordinate_space": "body_normalized_v1",
        "landmarks": landmarks,
    }, 1)


class PoseSearchRangeTests(unittest.TestCase):
    def test_extracts_one_complete_shared_variable_vector(self):
        variables = extract_pose_variables(pose(BASE))
        self.assertEqual(set(variables), set(VARIABLE_DEFINITIONS))
        self.assertGreater(variables["stance_width"], 0)
        self.assertGreaterEqual(variables["left_knee_flexion"], 5)

    def test_endpoints_define_bounds_and_margin_is_applied_by_unit(self):
        changed = {name: list(position) for name, position in BASE.items()}
        changed["knee_left"] = [-0.62, -0.72, 0.08]
        result = generate_search_ranges(
            pose(BASE),
            pose(changed),
            {"angle_degrees": 5, "position_normalized": 0.1},
        )
        knee = result["ranges"]["left_knee_flexion"]
        stance = result["ranges"]["stance_width"]
        self.assertAlmostEqual(knee["search_min"], min(knee["pose_a_value"], knee["pose_b_value"]) - 5, places=5)
        self.assertAlmostEqual(stance["search_min"], max(0.1, min(stance["pose_a_value"], stance["pose_b_value"]) - 0.1), places=5)

    def test_generated_ranges_respect_every_constraint(self):
        result = generate_search_ranges(
            pose(BASE), pose(BASE), {"angle_degrees": 30, "position_normalized": 0.25}
        )
        for variable in result["ranges"].values():
            self.assertGreaterEqual(variable["search_min"], variable["constraint_min"])
            self.assertLessEqual(variable["search_max"], variable["constraint_max"])

    def test_large_position_margin_is_clipped_to_safe_constraints(self):
        result = generate_search_ranges(
            pose(BASE), pose(BASE), {"angle_degrees": 3, "position_normalized": 5.0}
        )
        for variable in result["ranges"].values():
            self.assertGreaterEqual(variable["search_min"], variable["constraint_min"])
            self.assertLessEqual(variable["search_max"], variable["constraint_max"])

    def test_range_generation_is_deterministic(self):
        first = generate_search_ranges(pose(BASE), pose(BASE), {"angle_degrees": 3})
        second = generate_search_ranges(pose(BASE), pose(BASE), {"angle_degrees": 3})
        self.assertEqual(first, second)

    def test_unsafe_endpoint_is_rejected_instead_of_silently_clipped(self):
        unsafe = {name: list(position) for name, position in BASE.items()}
        unsafe["ankle_left"] = list(unsafe["knee_left"])
        with self.assertRaises(HTTPException):
            generate_search_ranges(pose(BASE), pose(unsafe))


if __name__ == "__main__":
    unittest.main()
