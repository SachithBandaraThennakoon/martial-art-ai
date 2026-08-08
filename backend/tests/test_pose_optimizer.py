import unittest

from fastapi import HTTPException

from services.pose_optimization_schema import DEFAULT_OBJECTIVE_WEIGHTS, normalize_reference_pose
from services.pose_optimizer import optimize_pose_variables
from services.pose_search_ranges import generate_search_ranges


BASE = {
    "head": [0, 1.65, 0], "shoulder_left": [-0.52, 1.15, 0], "shoulder_right": [0.52, 1.15, 0],
    "elbow_left": [-0.84, 0.67, 0.02], "elbow_right": [0.84, 0.67, 0.02],
    "wrist_left": [-0.42, 0.9, 0.12], "wrist_right": [0.42, 0.9, 0.12],
    "hip_left": [-0.38, 0.1, -0.12], "hip_right": [0.38, 0.1, 0.12],
    "knee_left": [-0.5, -0.72, 0.18], "knee_right": [0.5, -0.72, -0.18],
    "ankle_left": [-0.58, -1.45, 0.38], "ankle_right": [0.58, -1.45, -0.38],
    "foot_left": [-0.58, -1.58, 0.72], "foot_right": [0.58, -1.58, -0.04],
}


def pose(landmarks):
    return normalize_reference_pose({"coordinate_space": "body_normalized_v1", "landmarks": landmarks}, 1)


def ranges():
    changed = {name: list(position) for name, position in BASE.items()}
    changed["wrist_left"] = [-0.62, 0.72, 0.2]
    changed["wrist_right"] = [0.58, 0.78, 0.1]
    changed["knee_left"] = [-0.62, -0.68, 0.24]
    return generate_search_ranges(pose(BASE), pose(changed), {"angle_degrees": 8, "position_normalized": 0.12})


class PoseOptimizerTests(unittest.TestCase):
    def test_nsga_ii_returns_joint_pareto_solutions_and_representative(self):
        result = optimize_pose_variables(ranges(), DEFAULT_OBJECTIVE_WEIGHTS, seed=7, population_size=16, generations=5)
        self.assertEqual(result["algorithm"], "pymoo_nsga2")
        self.assertEqual(len(result["decision_variable_ids"]), 17)
        self.assertGreater(result["pareto_solution_count"], 0)
        self.assertEqual(sum(item["representative"] for item in result["pareto_solutions"]), 1)
        self.assertEqual(set(result["representative_scores"]), set(DEFAULT_OBJECTIVE_WEIGHTS))

    def test_every_solution_remains_inside_generated_bounds(self):
        search = ranges()
        result = optimize_pose_variables(search, DEFAULT_OBJECTIVE_WEIGHTS, seed=11, population_size=16, generations=5)
        for solution in result["pareto_solutions"]:
            for variable_id, value in solution["variables"].items():
                self.assertGreaterEqual(value, search["ranges"][variable_id]["search_min"])
                self.assertLessEqual(value, search["ranges"][variable_id]["search_max"])

    def test_seed_makes_results_reproducible(self):
        first = optimize_pose_variables(ranges(), DEFAULT_OBJECTIVE_WEIGHTS, seed=19, population_size=16, generations=5)
        second = optimize_pose_variables(ranges(), DEFAULT_OBJECTIVE_WEIGHTS, seed=19, population_size=16, generations=5)
        self.assertEqual(first, second)

    def test_at_least_two_objectives_are_required(self):
        weights = {objective: 0 for objective in DEFAULT_OBJECTIVE_WEIGHTS}
        weights["joint_safety"] = 1
        with self.assertRaisesRegex(HTTPException, "at least two"):
            optimize_pose_variables(ranges(), weights, population_size=16, generations=5)

    def test_representative_is_a_feasible_complete_landmark_pose(self):
        changed = {name: list(position) for name, position in BASE.items()}
        changed["wrist_left"] = [-0.62, 0.72, 0.2]
        first = pose(BASE)
        second = pose(changed)
        result = optimize_pose_variables(
            generate_search_ranges(first, second, {"angle_degrees": 3, "position_normalized": 0.03}),
            DEFAULT_OBJECTIVE_WEIGHTS,
            pose_a=first,
            pose_b=second,
            seed=23,
            population_size=16,
            generations=5,
        )
        self.assertTrue(result["representative_reconstruction"]["feasible"])
        self.assertEqual(result["representative_pose"]["coordinate_space"], "body_normalized_v1")
        self.assertEqual(len(result["representative_pose"]["landmarks"]), 15)


if __name__ == "__main__":
    unittest.main()
