import hashlib
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db
from models.technique import Technique
from models.training_memory import PracticeSession, PracticeSessionTape
from models.user import User
from tests.test_tape_storage import valid_document
from utils.security import create_access_token


class TapeAPITests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.user = User(
            email="tape@example.com",
            password_hash="unused",
            role="user",
            plan="FREE_PLAN",
            subscription_status="inactive",
        )
        technique = Technique(name="Jab", category="Boxing", required_plan="FREE_PLAN")
        self.db.add_all([self.user, technique])
        self.db.commit()
        self.session = PracticeSession(
            user_id=self.user.id,
            technique_id=technique.id,
            technique_name="Jab",
            target_reps=3,
            status="completed",
        )
        self.db.add(self.session)
        self.db.commit()
        self.token = create_access_token({"sub": str(self.user.id), "uid": self.user.id})
        main.app.dependency_overrides[get_db] = lambda: self.db
        self.limit_patch = patch("main.enforce_rate_limits")
        self.limit_patch.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.limit_patch.stop()
        main.app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def headers(self, **extra):
        return {"Authorization": f"Bearer {self.token}", **extra}

    def test_inline_intent_store_read_and_idempotent_retry(self):
        document = valid_document()
        document["metadata"]["sessionId"] = self.session.id
        raw = json.dumps(document, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode()).hexdigest()
        key = "tapeuploadidempotency000000000001"
        intent = self.client.post(
            f"/practice/sessions/{self.session.id}/tape/upload-intent",
            headers=self.headers(),
            json={
                "version": 2,
                "frame_rate": 30,
                "frame_count": 2,
                "duration_ms": 34,
                "content_length": len(raw.encode()),
                "content_sha256": digest,
                "idempotency_key": key,
                "algorithm_version": "biomechanics-v2",
                "config_version": "jab-2026-08",
            },
        )
        self.assertEqual(intent.status_code, 200)
        self.assertEqual(intent.json()["storage_mode"], "database")

        stored = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(**{"Content-Type": "application/json", "Idempotency-Key": key}),
            content=raw,
        )
        self.assertEqual(stored.status_code, 200)
        tape = self.db.query(PracticeSessionTape).one()
        self.assertEqual(tape.content_sha256, digest)
        self.assertEqual(tape.capture_source, "device_estimate")

        retried = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(**{"Content-Type": "application/json", "Idempotency-Key": key}),
            content=raw,
        )
        self.assertEqual(retried.status_code, 200)
        self.assertTrue(retried.json()["idempotent"])

        loaded = self.client.get(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(),
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(len(loaded.json()["frames"]), 2)
        self.assertEqual(loaded.json()["storage"]["capture_source"], "device_estimate")

    def test_invalid_tape_is_rejected_before_persistence(self):
        document = valid_document()
        document["frames"][0]["unexpected"] = [1] * 100
        raw = json.dumps(document)
        response = self.client.put(
            f"/practice/sessions/{self.session.id}/tape",
            headers=self.headers(
                **{
                    "Content-Type": "application/json",
                    "Idempotency-Key": "tapeuploadidempotency000000000002",
                }
            ),
            content=raw,
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.query(PracticeSessionTape).count(), 0)


if __name__ == "__main__":
    unittest.main()
