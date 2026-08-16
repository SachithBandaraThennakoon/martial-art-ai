from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from awareness.repository import persist_snapshot
from awareness.retention import prune_awareness_data, retention_policy
from awareness.schemas import AwarenessSnapshot, utc_now
from database import Base
from models.awareness import AwarenessEventRecord, AwarenessSession
from models.user import User


class AwarenessRetentionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.user = User(email="retention@example.com", password_hash="unused", role="admin")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_policy_uses_safe_defaults_and_valid_environment_overrides(self):
        with patch.dict("os.environ", {"AWARENESS_EVENT_RETENTION_DAYS": "3", "AWARENESS_SESSION_RETENTION_DAYS": "bad"}):
            policy = retention_policy()
            self.assertEqual(policy.events_days, 3)
            self.assertEqual(policy.sessions_days, 30)

    def test_dry_run_reports_without_deleting_then_prunes(self):
        persist_snapshot(self.db, AwarenessSnapshot(
            session_key="old.session", sequence=1, revision=1,
            owner_user_id=self.user.id, received_at=utc_now(),
            awareness={"situation_state": "observing"},
        ))
        old = datetime.now(timezone.utc) - timedelta(days=60)
        session = self.db.query(AwarenessSession).one()
        session.updated_at = old
        self.db.query(AwarenessEventRecord).update({AwarenessEventRecord.created_at: old})
        self.db.commit()

        preview = prune_awareness_data(self.db, dry_run=True)
        self.assertEqual(preview["eligible"]["sessions"], 1)
        self.assertEqual(preview["deleted"]["sessions"], 0)
        self.assertEqual(self.db.query(AwarenessSession).count(), 1)

        result = prune_awareness_data(self.db, dry_run=False)
        self.assertEqual(result["deleted"]["sessions"], 1)
        self.assertEqual(result["deleted"]["events"], 1)
        self.assertEqual(self.db.query(AwarenessSession).count(), 0)


if __name__ == "__main__":
    unittest.main()
