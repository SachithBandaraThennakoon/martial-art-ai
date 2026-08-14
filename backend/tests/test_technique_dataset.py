import math
import unittest

from services.technique_package_loader import (
    TECHNIQUE_ROOT,
    load_technique_catalog,
    load_technique_packages,
)

SUPPORTED_TARGETS = {
    "elbow_left",
    "elbow_right",
    "shoulder_left",
    "shoulder_right",
    "knee_left",
    "knee_right",
    "hip_left",
    "hip_right",
    "ankle_left",
    "ankle_right",
    "wrist_left",
    "wrist_right",
    "fist_left",
    "fist_right",
    "hand_left_open",
    "hand_right_open",
    "face_forward",
    "eyes_forward",
    "face_calm",
}

ANGLE_LANDMARKS = {
    "elbow_left": ("shoulder_left", "elbow_left", "wrist_left"),
    "elbow_right": ("shoulder_right", "elbow_right", "wrist_right"),
    "shoulder_left": ("elbow_left", "shoulder_left", "hip_left"),
    "shoulder_right": ("elbow_right", "shoulder_right", "hip_right"),
    "hip_left": ("shoulder_left", "hip_left", "knee_left"),
    "hip_right": ("shoulder_right", "hip_right", "knee_right"),
    "knee_left": ("hip_left", "knee_left", "ankle_left"),
    "knee_right": ("hip_right", "knee_right", "ankle_right"),
    "ankle_left": ("knee_left", "ankle_left", "foot_left"),
    "ankle_right": ("knee_right", "ankle_right", "foot_right"),
}


def pose_angle(landmarks, body_part):
    first, center, last = (landmarks[name] for name in ANGLE_LANDMARKS[body_part])
    left = [value - center[index] for index, value in enumerate(first)]
    right = [value - center[index] for index, value in enumerate(last)]
    denominator = math.sqrt(sum(value * value for value in left) * sum(value * value for value in right))
    cosine = max(-1.0, min(1.0, sum(a * b for a, b in zip(left, right)) / denominator))
    return round(math.degrees(math.acos(cosine)))


class TechniqueDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = load_technique_catalog()
        cls.techniques = cls.dataset["techniques"]
        cls.packages = load_technique_packages()

    def test_index_discovers_every_technique_package(self):
        self.assertEqual(len(self.packages), len(self.techniques))
        self.assertGreaterEqual(len(self.packages), 33)
        for package in self.packages:
            with self.subTest(technique=package["catalog"]["name"]):
                self.assertTrue((package["directory"] / "catalog.json").is_file())
                self.assertTrue((package["directory"] / "training-steps.json").is_file())

    def test_technique_names_are_unique(self):
        names = [technique["name"] for technique in self.techniques]
        self.assertEqual(len(names), len(set(names)))

    def test_technique_ids_are_unique_and_match_directories(self):
        ids = [technique["id"] for technique in self.techniques]
        self.assertEqual(len(ids), len(set(ids)))
        for package in self.packages:
            self.assertEqual(
                package["catalog"]["id"],
                package["directory"].name,
            )

    def test_temporal_packages_are_complete(self):
        tracked = {
            package["catalog"]["id"]
            for package in self.packages
            if package["has_tracking"]
        }
        self.assertEqual(tracked, {"jab", "front-kick"})

    def test_published_jab_guide_reuses_training_keyframes(self):
        jab = next(package for package in self.packages if package["catalog"]["id"] == "jab")
        guide = jab["learning_content"]
        self.assertEqual(guide["technique_id"], "jab")
        self.assertEqual(guide["status"], "PUBLISHED")
        self.assertEqual(guide["animation"]["source"], "training_steps")
        self.assertTrue(guide["overview"]["safety"])
        self.assertTrue(guide["principles"])
        self.assertTrue(all(step.get("reference_pose") for step in jab["training_steps"]["steps"]))

    def test_every_technique_has_one_to_twelve_ordered_steps(self):
        for technique in self.techniques:
            with self.subTest(technique=technique["name"]):
                steps = technique["steps"]
                self.assertGreaterEqual(len(steps), 1)
                self.assertLessEqual(len(steps), 12)
                self.assertEqual(
                    [step["step_number"] for step in steps],
                    list(range(1, len(steps) + 1)),
                )

    def test_descriptions_include_setup_or_safety_context(self):
        for technique in self.techniques:
            with self.subTest(technique=technique["name"]):
                self.assertGreaterEqual(len(technique["description"].strip()), 20)

    def test_striking_surfaces_use_supported_ids(self):
        supported = {
            "", "ball_of_foot", "heel", "instep", "outer_edge",
            "inner_edge", "sole", "toes", "shin", "knee",
        }
        for technique in self.packages:
            for step in technique["training_steps"]["steps"]:
                with self.subTest(technique=technique["catalog"]["id"], step=step["step_number"]):
                    self.assertIn(step.get("striking_surface", ""), supported)
                    self.assertIn(step.get("striking_side", ""), {"", "left", "right", "both"})
                    if step.get("striking_surface"):
                        self.assertTrue(step.get("striking_side"))

    def test_targets_are_supported_unique_and_in_range(self):
        for technique in self.techniques:
            for step in technique["steps"]:
                with self.subTest(technique=technique["name"], step=step["step_name"]):
                    self.assertTrue(step["angles"])
                    target_names = [target["body_part"] for target in step["angles"]]
                    self.assertEqual(len(target_names), len(set(target_names)))
                    self.assertTrue(set(target_names).issubset(SUPPORTED_TARGETS))

                    for target in step["angles"]:
                        self.assertGreaterEqual(target["min"], 0)
                        self.assertLessEqual(target["max"], 180)
                        self.assertLessEqual(target["min"], target["max"])

    def test_reference_skeleton_and_target_angle_data_tally(self):
        for package in self.packages:
            for step in package["training_steps"].get("steps", []):
                landmarks = (step.get("reference_pose") or {}).get("landmarks")
                if not landmarks:
                    continue
                for target in step.get("angle_targets", []):
                    if target["body_part"] not in ANGLE_LANDMARKS:
                        continue
                    with self.subTest(
                        technique=package["catalog"]["id"],
                        step=step["step_number"],
                        body_part=target["body_part"],
                    ):
                        self.assertEqual(target.get("target_angle"), pose_angle(landmarks, target["body_part"]))


if __name__ == "__main__":
    unittest.main()
