import unittest

from services.pose_biomechanics import evaluate_variables
from services.pose_optimization_schema import DEFAULT_OBJECTIVE_WEIGHTS
from services.pose_sensitivity import analyze_sensitivity_and_robustness, derive_optimal_region
from services.pose_variables import VARIABLE_DEFINITIONS


def representative():
    return {
        "left_elbow_flexion": 90, "right_elbow_flexion": 90,
        "left_shoulder_angle": 70, "right_shoulder_angle": 70,
        "left_hip_angle": 145, "right_hip_angle": 145,
        "left_knee_flexion": 140, "right_knee_flexion": 140,
        "left_ankle_angle": 100, "right_ankle_angle": 100,
        "torso_lean": 10, "pelvis_rotation": -12, "shoulder_rotation": 12,
        "stance_width": 1.0, "stance_depth": 0.8, "guard_width": 0.7, "guard_height": 0.8,
    }


def search_ranges(center):
    result = {}
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        margin = 10 if definition.unit == "degrees" else 0.2
        result[variable_id] = {
            "search_min": max(definition.constraint_min, center[variable_id] - margin),
            "search_max": min(definition.constraint_max, center[variable_id] + margin),
        }
    return result


def pareto(center):
    solutions = []
    for index, shift in enumerate((-0.5, -0.25, 0, 0.25, 0.5)):
        variables = dict(center)
        variables["stance_width"] += shift * 0.2
        variables["guard_height"] += shift * 0.1
        scores = {target: details["score"] for target, details in evaluate_variables(variables)["targets"].items()}
        solutions.append({"id": f"pareto-{index + 1}", "variables": variables, "target_scores": scores, "ideal_distance": 0.05 + abs(shift) * 0.1})
    return solutions


class PoseSensitivityTests(unittest.TestCase):
    def test_derives_near_ideal_region_instead_of_full_pareto_envelope(self):
        center = representative()
        region, ids = derive_optimal_region(pareto(center))
        self.assertGreaterEqual(len(ids), 3)
        self.assertLess(region["stance_width"]["optimal_max"] - region["stance_width"]["optimal_min"], 0.2)

    def test_returns_every_variable_and_target(self):
        center = representative()
        result = analyze_sensitivity_and_robustness(center, search_ranges(center), pareto(center), DEFAULT_OBJECTIVE_WEIGHTS, seed=7, robustness_samples=8)
        self.assertEqual(set(result["variables"]), set(VARIABLE_DEFINITIONS))
        self.assertEqual(set(result["targets"]), set(DEFAULT_OBJECTIVE_WEIGHTS))
        for variable in result["variables"].values():
            self.assertIn(variable["sensitivity"], {"Low", "Medium", "High"})
            self.assertIn(variable["robustness"], {"Low", "Medium", "High"})

    def test_analysis_is_deterministic_for_seed(self):
        center = representative()
        first = analyze_sensitivity_and_robustness(center, search_ranges(center), pareto(center), DEFAULT_OBJECTIVE_WEIGHTS, seed=13, robustness_samples=8)
        second = analyze_sensitivity_and_robustness(center, search_ranges(center), pareto(center), DEFAULT_OBJECTIVE_WEIGHTS, seed=13, robustness_samples=8)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
