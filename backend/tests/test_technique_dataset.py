import json
import math
import unittest

from services.system_snapshots import TECHNIQUE_SNAPSHOT_DIR, load_technique_snapshot


SUPPORTED_TARGETS = {
    "elbow_left", "elbow_right", "shoulder_left", "shoulder_right",
    "knee_left", "knee_right", "hip_left", "hip_right",
    "ankle_left", "ankle_right", "wrist_left", "wrist_right",
    "fist_left", "fist_right", "hand_left_open", "hand_right_open",
    "face_forward", "eyes_forward", "face_calm",
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
        cls.snapshots = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(TECHNIQUE_SNAPSHOT_DIR.glob("*.json"))
        ]
        cls.authored = [
            snapshot for snapshot in cls.snapshots
            if (snapshot.get("training_config") or {}).get("steps")
        ]
        cls.tracked = [
            snapshot for snapshot in cls.snapshots
            if (snapshot["technique"].get("metadata") or {}).get("has_tracking")
        ]

    def test_snapshot_catalog_is_complete_and_resolvable(self):
        self.assertGreaterEqual(len(self.snapshots), 500)
        for snapshot in self.snapshots:
            technique = snapshot["technique"]
            with self.subTest(technique=technique["slug"]):
                self.assertEqual(load_technique_snapshot(technique["slug"]), snapshot)
                self.assertEqual(technique["status"], "active")

    def test_technique_slugs_are_unique(self):
        slugs = [item["technique"]["slug"] for item in self.snapshots]
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_only_reviewed_runtime_packages_enable_tracking(self):
        tracked = {
            item["technique"]["slug"] for item in self.snapshots
            if (item["technique"].get("metadata") or {}).get("has_tracking")
        }
        self.assertEqual(tracked, {"jab", "front-kick"})

    def test_published_jab_guide_reuses_training_keyframes(self):
        jab = load_technique_snapshot("jab")
        guide = jab["learning_content"]
        steps = jab["training_config"]["steps"]
        self.assertEqual(guide["technique_id"], "jab")
        self.assertEqual(guide["status"], "PUBLISHED")
        self.assertEqual(guide["animation"]["source"], "training_steps")
        self.assertTrue(guide["overview"]["safety"])
        self.assertTrue(guide["principles"])
        self.assertTrue(all(step.get("reference_pose") for step in steps))

    def test_authored_techniques_have_ordered_steps_and_descriptions(self):
        self.assertGreaterEqual(len(self.authored), 2)
        for snapshot in self.authored:
            technique = snapshot["technique"]
            steps = snapshot["training_config"]["steps"]
            with self.subTest(technique=technique["slug"]):
                self.assertGreaterEqual(len(technique["description"].strip()), 20)
                self.assertGreaterEqual(len(steps), 1)
                self.assertLessEqual(len(steps), 12)
                self.assertEqual(
                    [step["step_number"] for step in steps],
                    list(range(1, len(steps) + 1)),
                )

    def test_authored_targets_are_supported_unique_and_in_range(self):
        for snapshot in self.tracked:
            for step in snapshot["training_config"]["steps"]:
                targets = step.get("angle_targets", [])
                with self.subTest(technique=snapshot["technique"]["slug"], step=step["step_number"]):
                    self.assertTrue(targets)
                    names = [target["body_part"] for target in targets]
                    self.assertEqual(len(names), len(set(names)))
                    self.assertTrue(set(names).issubset(SUPPORTED_TARGETS))
                    for target in targets:
                        self.assertGreaterEqual(target["min"], 0)
                        self.assertLessEqual(target["max"], 180)
                        self.assertLessEqual(target["min"], target["max"])

    def test_reference_skeleton_and_target_angle_data_tally(self):
        for snapshot in self.tracked:
            for step in snapshot["training_config"]["steps"]:
                landmarks = (step.get("reference_pose") or {}).get("landmarks")
                if not landmarks:
                    continue
                for target in step.get("angle_targets", []):
                    if target["body_part"] not in ANGLE_LANDMARKS:
                        continue
                    with self.subTest(
                        technique=snapshot["technique"]["slug"],
                        step=step["step_number"],
                        body_part=target["body_part"],
                    ):
                        self.assertEqual(target.get("target_angle"), pose_angle(landmarks, target["body_part"]))


if __name__ == "__main__":
    unittest.main()
