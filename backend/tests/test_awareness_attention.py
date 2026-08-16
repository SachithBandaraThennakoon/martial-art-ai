import unittest

from awareness.attention import AttentionEngine
from awareness.inference import AwarenessInferenceEngine
from awareness.relationships import L1RelationshipEngine
from awareness.schemas import TemporalState, WorldObject


def item(identifier, kind="human", confidence=.9, verified=True, l1=None, l2=None, position=None):
    return WorldObject(
        object_id=identifier, object_type=kind, source="test",
        confidence=confidence, verified=verified,
        attributes={"position": position} if position is not None else {},
        state=TemporalState(l1=l1 or {}, l2=l2 or {}),
    )


class AttentionEngineTests(unittest.TestCase):
    def test_goal_changes_object_priority(self):
        objects = [item("user:primary"), item("weapon:1", "weapon")]
        engine = AttentionEngine()
        technique = engine.score({"type": "improve_user_technique"}, objects, [])
        threat = engine.score({"type": "detect_threat"}, objects, [])
        self.assertGreater(technique.objects["user:primary"]["priority"], technique.objects["weapon:1"]["priority"])
        self.assertGreater(threat.objects["weapon:1"]["priority"], threat.objects["user:primary"]["priority"])

    def test_unverified_evidence_is_penalized_and_not_focused(self):
        result = AttentionEngine().score({}, [
            item("user:primary", confidence=.7), item("weapon:1", "weapon", confidence=1, verified=False)
        ], [])
        self.assertEqual(result.focus["id"], "user:primary")
        self.assertLess(result.objects["weapon:1"]["priority"], result.objects["user:primary"]["priority"])


class AwarenessInferenceTests(unittest.TestCase):
    def infer(self, objects, relationships=None, goal=None):
        relationships = relationships or []
        attention = AttentionEngine().score(goal or {}, objects, relationships)
        return AwarenessInferenceEngine().infer(objects, relationships, attention)

    def test_waits_without_verified_objects(self):
        result = self.infer([item("user:primary", verified=False)])
        self.assertEqual(result["situation_state"], "waiting_for_perception")

    def test_low_tracking_is_explicit(self):
        result = self.infer([item("user:primary", confidence=.2)])
        self.assertEqual(result["situation_state"], "tracking_unclear")
        self.assertFalse(result["next_action"]["pause_training"])

    def test_supported_mistake_enters_correction(self):
        result = self.infer([item("user:primary", l2={"mistake_risk": .8})])
        self.assertEqual(result["situation_state"], "correcting")
        self.assertEqual(result["next_action"]["command"], "hold_current_step")

    def test_closing_opponent_relationship_gates_hazard(self):
        objects = [
            item("user:primary", l1={"velocity": [0, 0]}, position=[0, 0]),
            item("opponent:1", "opponent", l1={"velocity": [-1, 0]}, position=[1, 0]),
        ]
        relationships = L1RelationshipEngine().build(objects)
        result = self.infer(objects, relationships, {"type": "detect_threat"})
        self.assertEqual(result["situation_state"], "hazard_detected")
        self.assertTrue(result["next_action"]["pause_training"])


if __name__ == "__main__":
    unittest.main()
