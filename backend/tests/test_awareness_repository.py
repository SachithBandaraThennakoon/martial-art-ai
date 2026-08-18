import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from awareness.repository import (
    delete_long_term_memory, export_long_term_memory, list_sessions,
    load_events, load_long_term_memory, load_snapshot,
    persist_action_deliveries, persist_snapshot,
)
from awareness.schemas import ActionDeliveryBatch, AwarenessSnapshot, TemporalState, WorldObject, utc_now
from database import Base
from models.user import User


class AwarenessRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.user = User(email="awareness@example.com", password_hash="unused", role="admin")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def snapshot(self, revision=1, sequence=1, situation="observing"):
        return AwarenessSnapshot(
            session_key="admin.jab.live",
            sequence=sequence,
            revision=revision,
            owner_user_id=self.user.id,
            received_at=utc_now(),
            objects=[WorldObject(
                object_id="user:primary", object_type="human", source="mediapipe",
                confidence=.8, verified=True, state=TemporalState(l1={"fps": 10}),
            )],
            awareness={"situation_state": situation},
        )

    def test_persists_latest_snapshot_and_events(self):
        persist_snapshot(self.db, self.snapshot())
        persist_snapshot(self.db, self.snapshot(2, 2, "correcting"))
        latest = load_snapshot(self.db, self.user.id, "admin.jab.live")
        self.assertEqual(latest.revision, 2)
        self.assertEqual(len(load_events(self.db, self.user.id, "admin.jab.live")), 2)
        self.assertEqual(list_sessions(self.db, self.user.id)[0].object_count, 1)

    def test_duplicate_revision_is_idempotent(self):
        persist_snapshot(self.db, self.snapshot())
        persist_snapshot(self.db, self.snapshot())
        self.assertEqual(len(load_events(self.db, self.user.id, "admin.jab.live")), 1)

    def test_unchanged_frames_update_snapshot_without_event_noise(self):
        persist_snapshot(self.db, self.snapshot())
        persist_snapshot(self.db, self.snapshot(2, 2))
        self.assertEqual(load_snapshot(self.db, self.user.id, "admin.jab.live").revision, 2)
        self.assertEqual(len(load_events(self.db, self.user.id, "admin.jab.live")), 1)

    def test_l4_memory_survives_across_sessions(self):
        persist_snapshot(self.db, self.snapshot())
        second = self.snapshot(revision=1, sequence=1)
        second = second.model_copy(update={"session_key": "admin.jab.second"})
        persist_snapshot(self.db, second)
        objects, relationships = load_long_term_memory(self.db, self.user.id)
        self.assertEqual(objects["user:primary"]["sessions_observed"], 2)
        self.assertEqual(objects["user:primary"]["lifetime_observations"], 2)
        self.assertEqual(relationships, {})

    def test_memory_export_includes_decay_metadata_and_can_be_deleted(self):
        persist_snapshot(self.db, self.snapshot())
        exported = export_long_term_memory(self.db, self.user.id)
        self.assertEqual(exported["objects"][0]["object_id"], "user:primary")
        self.assertGreater(exported["objects"][0]["l4"]["memory_confidence"], .99)
        self.assertEqual(delete_long_term_memory(self.db, self.user.id)["deleted"]["objects"], 1)
        self.assertEqual(export_long_term_memory(self.db, self.user.id)["objects"], [])

    def test_action_delivery_acknowledgements_are_idempotent(self):
        persist_snapshot(self.db, self.snapshot())
        batch = ActionDeliveryBatch(revision=1, deliveries=[{
            "action_id": "visual:display:0", "channel": "visual",
            "command": "display", "status": "delivered", "latency_ms": 4.5,
        }])
        first = persist_action_deliveries(self.db, self.user.id, "admin.jab.live", batch)
        second = persist_action_deliveries(self.db, self.user.id, "admin.jab.live", batch)
        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0]["status"], "delivered")


if __name__ == "__main__":
    unittest.main()
