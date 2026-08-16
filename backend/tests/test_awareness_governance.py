import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from awareness.knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile
from awareness.knowledge_repository import (
    activate_profile, active_profile, create_profile, list_profiles, submit_profile,
)
from awareness.repository import load_decision_evaluations, persist_snapshot
from awareness.schemas import AwarenessSnapshot, TemporalState, WorldObject, utc_now
from database import Base
from models.user import User


class AwarenessGovernanceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.admin = User(email="governance@example.com", password_hash="unused", role="admin")
        self.db.add(self.admin)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def profile(self, version):
        payload = DEFAULT_KNOWLEDGE.model_dump()
        payload["version"] = version
        return KnowledgeProfile.model_validate(payload)

    def test_draft_review_activation_and_single_active_profile(self):
        first = create_profile(self.db, self.admin.id, self.profile("1.1.0"))
        self.assertEqual(first.status, "draft")
        submit_profile(self.db, first.id)
        activate_profile(self.db, first.id, self.admin.id)
        self.assertEqual(active_profile(self.db).version, "1.1.0")

        second = create_profile(self.db, self.admin.id, self.profile("1.2.0"))
        submit_profile(self.db, second.id)
        activate_profile(self.db, second.id, self.admin.id)
        self.assertEqual(active_profile(self.db).version, "1.2.0")
        statuses = {record.version: record.status for record in list_profiles(self.db)}
        self.assertEqual(statuses["1.1.0"], "retired")
        self.assertEqual(statuses["1.2.0"], "active")

    def test_duplicate_version_and_invalid_transition_are_rejected(self):
        record = create_profile(self.db, self.admin.id, self.profile("1.1.0"))
        with self.assertRaises(HTTPException):
            create_profile(self.db, self.admin.id, self.profile("1.1.0"))
        with self.assertRaises(HTTPException):
            activate_profile(self.db, record.id, self.admin.id)

    def snapshot(self, revision, state):
        comparison = {
            "client": {"situation_state": state, "command": "continue"},
            "backend": {"situation_state": state, "command": "continue", "confidence": .8},
            "agreement": {"state": True, "command": True},
            "comparable": True,
        }
        return AwarenessSnapshot(
            session_key="evaluation.test", revision=revision, sequence=revision,
            owner_user_id=self.admin.id, received_at=utc_now(),
            objects=[WorldObject(
                object_id="user:primary", object_type="human", source="test",
                confidence=.9, verified=True, state=TemporalState(),
            )],
            awareness={"situation_state": state, "backend_inference": {"situation_state": state}},
            metadata={
                "decision_comparison": comparison,
                "world_model": {"knowledge": {"profile_id": "test", "version": "1.0"}},
            },
        )

    def test_evaluations_are_stored_only_for_meaningful_transitions(self):
        persist_snapshot(self.db, self.snapshot(1, "observing"))
        persist_snapshot(self.db, self.snapshot(2, "observing"))
        persist_snapshot(self.db, self.snapshot(3, "correcting"))
        evaluations = load_decision_evaluations(self.db, self.admin.id, "evaluation.test")
        self.assertEqual(len(evaluations), 2)
        self.assertEqual(evaluations[0]["revision"], 3)
        self.assertTrue(evaluations[0]["state_agreement"])


if __name__ == "__main__":
    unittest.main()
