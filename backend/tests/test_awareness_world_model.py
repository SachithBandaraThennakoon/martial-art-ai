import unittest

from awareness.object_association import ObjectAssociationEngine
from awareness.relationships import L1RelationshipEngine
from awareness.schemas import TemporalState, WorldObject
from awareness.world_model import WorldModelEngine
from awareness.schemas import AwarenessSnapshotInput


def entity(identifier, kind, position=None, velocity=None, confidence=.9, verified=True):
    return WorldObject(
        object_id=identifier,
        object_type=kind,
        source="detector",
        confidence=confidence,
        verified=verified,
        attributes={"position": position} if position is not None else {},
        state=TemporalState(l1={"velocity": velocity} if velocity is not None else {}),
    )


class ObjectAssociationTests(unittest.TestCase):
    def test_temporary_detections_keep_stable_identity_by_position(self):
        engine = ObjectAssociationEngine(distance_threshold=.2)
        first = engine.associate(1, "session", 1, [entity("detection:1", "opponent", [0.2, .3])])[0]
        second = engine.associate(1, "session", 2, [entity("detection:2", "opponent", [0.22, .31])])[0]
        self.assertEqual(first.object_id, second.object_id)
        self.assertEqual(second.attributes["tracking"]["association"], "nearest_position")
        self.assertEqual(second.attributes["tracking"]["observations"], 2)

    def test_far_detection_creates_new_track(self):
        engine = ObjectAssociationEngine(distance_threshold=.1)
        first = engine.associate(1, "session", 1, [entity("detection:1", "weapon", [0, 0])])[0]
        second = engine.associate(1, "session", 2, [entity("detection:2", "weapon", [1, 1])])[0]
        self.assertNotEqual(first.object_id, second.object_id)


class RelationshipEngineTests(unittest.TestCase):
    def test_builds_distance_relative_velocity_and_closing_speed(self):
        relations = L1RelationshipEngine(contact_threshold=.2).build([
            entity("user", "human", [0, 0], [1, 0], confidence=.9),
            entity("opponent", "human", [1, 0], [0, 0], confidence=.8),
        ])
        self.assertEqual(len(relations), 1)
        l1 = relations[0].state.l1
        self.assertAlmostEqual(l1["distance"], 1)
        self.assertAlmostEqual(l1["closing_speed"], 1)
        self.assertFalse(l1["contact"])
        self.assertEqual(relations[0].confidence, .8)

    def test_does_not_invent_relation_without_positions(self):
        self.assertEqual(L1RelationshipEngine().build([
            entity("user", "human"), entity("weapon", "weapon")
        ]), [])

    def test_unverified_objects_do_not_form_relationships(self):
        self.assertEqual(L1RelationshipEngine().build([
            entity("user", "human", [0, 0]),
            entity("weapon", "weapon", [.1, 0], verified=False),
        ]), [])


class WorldModelTests(unittest.TestCase):
    def test_process_adds_engine_metadata(self):
        engine = WorldModelEngine()
        result = engine.process(1, AwarenessSnapshotInput(
            session_key="world.test", sequence=1,
            objects=[entity("user:primary", "human")],
        ))
        self.assertEqual(result.metadata["world_model"]["verified_objects"], 1)
        self.assertEqual(result.metadata["world_model"]["verified_relationships"], 0)


if __name__ == "__main__":
    unittest.main()
