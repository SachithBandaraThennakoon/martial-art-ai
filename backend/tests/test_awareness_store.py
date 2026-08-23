import unittest

from awareness.schemas import AwarenessSnapshotInput, TemporalState, WorldObject, WorldRelationship
from awareness.store import AwarenessStore


class AwarenessStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = AwarenessStore(
            max_events_per_session=10,
            checkpoint_interval_seconds=3600,
            checkpoint_sequence_interval=2,
            max_sessions=2,
        )

    def payload(self, sequence=1):
        return AwarenessSnapshotInput(
            session_key="admin.jab.live",
            sequence=sequence,
            goal={"type": "improve_user_technique"},
            objects=[WorldObject(
                object_id="user:primary",
                object_type="human",
                source="mediapipe",
                confidence=0.9,
                verified=True,
                state=TemporalState(l1={"tracking": "live"}, l2={"action": "jab"}),
            )],
            awareness={"situation_state": "correcting"},
        )

    def test_ingest_builds_revision_and_event(self):
        first = self.store.ingest(7, self.payload(1))
        second = self.store.ingest(7, self.payload(2))
        self.assertEqual(first.revision, 1)
        self.assertEqual(second.revision, 2)
        self.assertEqual(self.store.get_snapshot("admin.jab.live", 7).sequence, 2)
        self.assertEqual(len(self.store.get_events("admin.jab.live", 7)), 2)

    def test_stale_sequence_does_not_replace_latest_snapshot(self):
        self.store.ingest(7, self.payload(4))
        stale = self.store.ingest(7, self.payload(3))
        self.assertEqual(stale.sequence, 4)
        self.assertEqual(stale.revision, 1)

    def test_checkpointing_is_periodic_and_transition_aware(self):
        first = self.store.ingest(7, self.payload(1))
        self.assertTrue(self.store.should_checkpoint(first))
        self.store.mark_checkpoint(first)
        second = self.store.ingest(7, self.payload(2))
        self.assertFalse(self.store.should_checkpoint(second))
        third = self.store.ingest(7, self.payload(3))
        self.assertTrue(self.store.should_checkpoint(third))

    def test_owner_isolation(self):
        self.store.ingest(7, self.payload())
        self.assertIsNone(self.store.get_snapshot("admin.jab.live", 8))
        other = self.store.ingest(8, self.payload(2))
        self.assertEqual(other.owner_user_id, 8)
        self.assertEqual(self.store.get_snapshot("admin.jab.live", 7).sequence, 1)

    def test_hot_session_store_evicts_the_oldest_session(self):
        self.store.ingest(7, self.payload(1))
        second = self.payload(1).model_copy(update={"session_key": "admin.cross.live"})
        third = self.payload(1).model_copy(update={"session_key": "admin.hook.live"})
        self.store.ingest(7, second)
        self.store.ingest(7, third)

        self.assertIsNone(self.store.get_snapshot("admin.jab.live", 7))
        self.assertIsNotNone(self.store.get_snapshot("admin.hook.live", 7))

    def test_long_term_memory_cache_returns_defensive_copies(self):
        self.store.set_long_term_memory(7, {"user:primary": {"skill": .5}}, {})
        objects, relationships = self.store.get_long_term_memory(7)
        objects["user:primary"]["skill"] = 1

        cached_objects, cached_relationships = self.store.get_long_term_memory(7)
        self.assertEqual(cached_objects["user:primary"]["skill"], .5)
        self.assertEqual(relationships, cached_relationships)

    def test_relationship_requires_known_endpoints(self):
        with self.assertRaises(ValueError):
            AwarenessSnapshotInput(
                session_key="bad.relation",
                objects=[],
                relationships=[WorldRelationship(
                    relationship_id="user-floor",
                    source_id="user:primary",
                    target_id="floor:primary",
                    relationship_type="supported_by",
                )],
            )


if __name__ == "__main__":
    unittest.main()
