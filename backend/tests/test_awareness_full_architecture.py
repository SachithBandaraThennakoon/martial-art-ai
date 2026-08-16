from datetime import datetime, timedelta, timezone
import unittest

from awareness.attention import AttentionEngine
from awareness.reasoning import DecisionPolicy
from awareness.relationships import L1RelationshipEngine
from awareness.schemas import AwarenessSnapshotInput, TemporalState, WorldObject
from awareness.temporal import ObjectTemporalEngine
from awareness.world_model import WorldModelEngine


def entity(identifier="user:primary", kind="human", position=None, confidence=.9, l2=None):
    return WorldObject(
        object_id=identifier, object_type=kind, source="test", confidence=confidence,
        verified=True, attributes={"position": position} if position is not None else {},
        state=TemporalState(l2=l2 or {}),
    )


class FullObjectTemporalTests(unittest.TestCase):
    def test_every_object_receives_computed_l1_l2_l3_l4(self):
        engine = ObjectTemporalEngine()
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        first = engine.enrich(1, "session.1", start, [
            entity("user:primary", position=[0, 0]),
            entity("floor:primary", "floor", [0, 1]),
        ])
        second = engine.enrich(1, "session.1", start + timedelta(seconds=1), [
            entity("user:primary", position=[1, 0]),
            entity("floor:primary", "floor", [0, 1]),
        ])
        self.assertEqual(second[0].state.l1["velocity"], (1, 0))
        self.assertEqual(second[0].state.l2["action"], "moving")
        for item in first + second:
            self.assertTrue(item.state.l1)
            self.assertTrue(item.state.l2)
            self.assertTrue(item.state.l3)
            self.assertTrue(item.state.l4)

    def test_l3_patterns_and_l4_cross_session_evolution_are_derived(self):
        engine = ObjectTemporalEngine()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        result = None
        for index, session in enumerate(("s1", "s1", "s1", "s2")):
            result = engine.enrich(1, session, now + timedelta(seconds=index), [
                entity(position=[index, 0], confidence=.7 + index * .05)
            ])[0]
        self.assertIn("moving", result.state.l3["repeated_patterns"])
        self.assertEqual(result.state.l4["sessions_observed"], 2)
        self.assertEqual(result.state.l4["evolution"], "improving")


class FullRelationshipTemporalTests(unittest.TestCase):
    def test_relationship_receives_all_levels_and_physical_fields(self):
        engine = L1RelationshipEngine(contact_threshold=.1)
        objects = [
            entity("user:primary", position=[0, 0]),
            WorldObject(
                object_id="wall:1", object_type="wall", source="scene", confidence=.9,
                verified=True, attributes={"position": [.2, 0]},
                state=TemporalState(l1={"velocity": [0, 0]}),
            ),
        ]
        relation = engine.build(objects, owner_user_id=1, session_key="s1")[0]
        self.assertIn("time_to_contact", relation.state.l1)
        self.assertTrue(relation.state.l1["movement_restriction"])
        self.assertTrue(relation.state.l2)
        self.assertTrue(relation.state.l3)
        self.assertTrue(relation.state.l4)


class FullClosedLoopTests(unittest.TestCase):
    def test_previous_awareness_is_used_on_next_world_update(self):
        engine = WorldModelEngine()
        first = engine.process(1, AwarenessSnapshotInput(
            session_key="closed.loop", sequence=1, objects=[entity(confidence=.9)]
        ))
        second = engine.process(1, AwarenessSnapshotInput(
            session_key="closed.loop", sequence=2,
            objects=[entity(confidence=.9, l2={"mistake_risk": .9})],
        ))
        self.assertFalse(first.metadata["world_model"]["previous_awareness_used"])
        self.assertTrue(second.metadata["world_model"]["previous_awareness_used"])
        backend = second.awareness["backend_inference"]
        self.assertEqual(backend["state_transition"], "observing_to_correcting")
        self.assertIn("uncertainty", backend)

    def test_utility_argmax_and_multichannel_actions_are_auditable(self):
        objects = [entity()]
        attention = AttentionEngine().score({}, objects, [])
        decision = DecisionPolicy().decide(
            {"type": "maximize_defense"},
            {"situation_state": "hazard_detected", "confidence": .9, "reason": "contact", "evidence": []},
            {"objects": {}, "relationships": {}, "trusted_forecast_count": 0}, attention,
        )
        self.assertEqual(decision["command"], max(decision["utility"]["candidates"], key=decision["utility"]["candidates"].get))
        self.assertEqual({item["channel"] for item in decision["actions"]}, {"visual", "system", "audio", "haptic"})


if __name__ == "__main__":
    unittest.main()
