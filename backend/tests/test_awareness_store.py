import unittest

from awareness.schemas import AwarenessSnapshotInput, TemporalState, WorldObject, WorldRelationship
from awareness.store import AwarenessStore


class AwarenessStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = AwarenessStore(max_events_per_session=10)

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

    def test_owner_isolation(self):
        self.store.ingest(7, self.payload())
        self.assertIsNone(self.store.get_snapshot("admin.jab.live", 8))
        other = self.store.ingest(8, self.payload(2))
        self.assertEqual(other.owner_user_id, 8)
        self.assertEqual(self.store.get_snapshot("admin.jab.live", 7).sequence, 1)

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
