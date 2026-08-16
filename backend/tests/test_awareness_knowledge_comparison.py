import unittest

from pydantic import ValidationError

from awareness.comparison import compare_client_backend
from awareness.knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile
from awareness.world_model import WorldModelEngine
from awareness.schemas import AwarenessSnapshotInput, TemporalState, WorldObject


class KnowledgeTests(unittest.TestCase):
    def test_default_profile_is_versioned_and_complete(self):
        self.assertEqual(DEFAULT_KNOWLEDGE.schema_version, "knowledge/v1")
        self.assertIn("detect_threat", DEFAULT_KNOWLEDGE.goal_weights)
        self.assertGreater(DEFAULT_KNOWLEDGE.horizons.l2_seconds, DEFAULT_KNOWLEDGE.horizons.l1_seconds)

    def test_invalid_threshold_is_rejected(self):
        payload = DEFAULT_KNOWLEDGE.model_dump()
        payload["thresholds"]["mistake_risk"] = 1.2
        with self.assertRaises(ValidationError):
            KnowledgeProfile.model_validate(payload)

    def test_world_snapshot_records_active_knowledge(self):
        result = WorldModelEngine().process(1, AwarenessSnapshotInput(
            session_key="knowledge.test",
            objects=[WorldObject(
                object_id="user:primary", object_type="human", source="test",
                confidence=.9, verified=True, state=TemporalState(),
            )],
        ))
        self.assertEqual(result.metadata["world_model"]["knowledge"]["version"], "1.0.0")


class ComparisonTests(unittest.TestCase):
    def test_reports_agreement_without_forcing_false_when_missing(self):
        result = compare_client_backend(
            {"situation_state": "correcting", "next_action": {"command": "hold_current_step"}},
            {"situation_state": "correcting"},
            {"command": "hold_current_step", "confidence": .8, "feedback": {"type": "correction"}},
        )
        self.assertTrue(result["agreement"]["state"])
        self.assertTrue(result["agreement"]["command"])
        missing = compare_client_backend({}, {"situation_state": "observing"}, {"command": "continue"})
        self.assertIsNone(missing["agreement"]["state"])
        self.assertFalse(missing["comparable"])


if __name__ == "__main__":
    unittest.main()
