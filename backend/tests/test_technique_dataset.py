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

    def test_every_technique_has_one_to_three_ordered_steps(self):
        for technique in self.techniques:
            with self.subTest(technique=technique["name"]):
                steps = technique["steps"]
                self.assertGreaterEqual(len(steps), 1)
                self.assertLessEqual(len(steps), 3)
                self.assertEqual(
                    [step["step_number"] for step in steps],
                    list(range(1, len(steps) + 1)),
                )

    def test_descriptions_include_setup_or_safety_context(self):
        for technique in self.techniques:
            with self.subTest(technique=technique["name"]):
                self.assertGreaterEqual(len(technique["description"].strip()), 20)

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


if __name__ == "__main__":
    unittest.main()
