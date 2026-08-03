import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth_context import get_current_user
from database import Base, get_db
from models.billing import BillingSubscription
from models.privacy import ConsentRecord
from models.refresh_session import RefreshSession
from models.technique import Technique  # noqa: F401 - registers FK target in test metadata
from models.training_memory import PracticeSession, PracticeSessionTape
from models.user import User
from routers.auth import router as auth_router
from routers.privacy import router as privacy_router
from services.privacy import PRIVACY_NOTICE_VERSION, TERMS_VERSION
from utils.security import hash_password


class PrivacyControlsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.user = User(
            name="Privacy Student",
            email="privacy@example.com",
            password_hash=hash_password("safe-password"),
            role="user",
            plan="FREE_PLAN",
            subscription_status="trial",
        )
        self.db.add(self.user)
        self.db.commit()
        self.app = FastAPI()
        self.app.include_router(auth_router)
        self.app.include_router(privacy_router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_registration_requires_current_documents_and_records_consent(self):
        response = self.client.post("/register", data={
            "name": "New Student",
            "email": "new@example.com",
            "password": "new-password",
            "privacy_version": PRIVACY_NOTICE_VERSION,
            "terms_version": TERMS_VERSION,
            "accept_privacy": "true",
            "accept_terms": "true",
            "confirm_minimum_age": "true",
        })
        self.assertEqual(response.status_code, 200)
        created = self.db.query(User).filter(User.email == "new@example.com").one()
        records = self.db.query(ConsentRecord).filter(ConsentRecord.user_id == created.id).all()
        self.assertEqual({record.document_type for record in records}, {"privacy_notice", "terms", "age_policy"})

    def test_export_excludes_authentication_secrets_and_raw_tape(self):
        self.db.add(RefreshSession(
            user_id=self.user.id,
            family_id="family",
            token_hash="secret-token-hash",
            replaced_by_hash="replacement-secret",
            expires_at=datetime(2099, 1, 1),
            user_agent_hash="user-agent-secret",
        ))
        practice = PracticeSession(user_id=self.user.id, technique_name="Test", status="completed")
        self.db.add(practice)
        self.db.flush()
        self.db.add(PracticeSessionTape(practice_session_id=practice.id, payload=b"private-tape", storage_provider="database"))
        self.db.commit()

        response = self.client.get("/account/export")
        self.assertEqual(response.status_code, 200)
        serialized = response.text
        self.assertNotIn("secret-token-hash", serialized)
        self.assertNotIn("replacement-secret", serialized)
        self.assertNotIn("user-agent-secret", serialized)
        self.assertNotIn("private-tape", serialized)
        self.assertEqual(response.json()["practice"]["tapes"][0]["download_path"], f"/practice/sessions/{practice.id}/tape")

    def test_account_deletion_requires_password_and_removes_owned_records(self):
        user_id = self.user.id
        practice = PracticeSession(user_id=self.user.id, technique_name="Test")
        self.db.add(practice)
        self.db.add(BillingSubscription(
            user_id=self.user.id,
            provider="paypal",
            provider_subscription_id="I-ACTIVE",
            provider_plan_id="P-TEST",
            internal_plan="PRO_PLAN",
            status="ACTIVE",
        ))
        self.db.commit()
        rejected = self.client.request("DELETE", "/account", json={"password": "wrong", "confirmation": "DELETE"})
        self.assertEqual(rejected.status_code, 401)

        with patch("routers.privacy.cancel_subscription", new=AsyncMock()) as cancel:
            response = self.client.request("DELETE", "/account", json={"password": "safe-password", "confirmation": "DELETE"})
            cancel.assert_awaited_once_with("I-ACTIVE", reason="Customer deleted account")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["deleted"])
        self.assertIsNone(self.db.query(User).filter(User.id == user_id).first())
        self.assertEqual(self.db.query(PracticeSession).count(), 0)


if __name__ == "__main__":
    unittest.main()
