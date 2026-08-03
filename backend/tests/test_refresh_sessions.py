import unittest
from datetime import timedelta

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models.refresh_session import RefreshSession
from models.user import User
from routers.auth import REFRESH_COOKIE_NAME, router as auth_router
from services.refresh_sessions import (
    hash_refresh_token,
    issue_refresh_session,
    revoke_refresh_token,
    rotate_refresh_session,
    utcnow_naive,
)
from utils.security import hash_password


class RefreshSessionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = User(
            name="Refresh Student",
            email="refresh@example.com",
            password_hash=hash_password("test-password"),
            role="user",
            plan="FREE_PLAN",
            subscription_status="trial",
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_refresh_token_is_hashed_at_rest(self):
        raw_token, session = issue_refresh_session(self.db, self.user, "test-agent")
        self.db.commit()

        self.assertNotEqual(raw_token, session.token_hash)
        self.assertEqual(session.token_hash, hash_refresh_token(raw_token))
        self.assertEqual(len(session.token_hash), 64)
        self.assertEqual(len(session.user_agent_hash), 64)

    def test_rotation_revokes_old_token_and_preserves_family(self):
        raw_token, original = issue_refresh_session(self.db, self.user)
        self.db.commit()
        family_id = original.family_id

        replacement_token, replacement, resolved_user = rotate_refresh_session(
            self.db,
            raw_token,
        )
        self.db.refresh(original)

        self.assertEqual(resolved_user.id, self.user.id)
        self.assertEqual(replacement.family_id, family_id)
        self.assertEqual(original.replaced_by_hash, replacement.token_hash)
        self.assertIsNotNone(original.revoked_at)
        self.assertIsNone(replacement.revoked_at)
        self.assertNotEqual(raw_token, replacement_token)

    def test_replay_of_rotated_token_revokes_newest_descendant(self):
        raw_token, _original = issue_refresh_session(self.db, self.user)
        self.db.commit()
        _replacement_token, replacement, _user = rotate_refresh_session(
            self.db,
            raw_token,
        )

        with self.assertRaises(HTTPException) as context:
            rotate_refresh_session(self.db, raw_token)

        self.db.refresh(replacement)
        self.assertEqual(context.exception.status_code, 401)
        self.assertIsNotNone(replacement.revoked_at)

    def test_expired_refresh_token_is_rejected_and_revoked(self):
        issued_at = utcnow_naive() - timedelta(days=31)
        raw_token, session = issue_refresh_session(
            self.db,
            self.user,
            now=issued_at,
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            rotate_refresh_session(self.db, raw_token)

        self.db.refresh(session)
        self.assertEqual(context.exception.status_code, 401)
        self.assertIsNotNone(session.revoked_at)

    def test_logout_revokes_the_complete_session_family(self):
        raw_token, original = issue_refresh_session(self.db, self.user)
        self.db.commit()
        replacement_token, replacement, _user = rotate_refresh_session(
            self.db,
            raw_token,
        )

        revoke_refresh_token(self.db, replacement_token)
        self.db.commit()
        self.db.refresh(original)
        self.db.refresh(replacement)

        self.assertIsNotNone(original.revoked_at)
        self.assertIsNotNone(replacement.revoked_at)

    def test_login_refresh_and_logout_use_httponly_cookie(self):
        app = FastAPI()
        app.include_router(auth_router)

        def override_db():
            yield self.db

        app.dependency_overrides[get_db] = override_db
        client = TestClient(app)

        login_response = client.post(
            "/login",
            data={"email": self.user.email, "password": "test-password"},
        )
        first_cookie = client.cookies.get(REFRESH_COOKIE_NAME)

        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json()["access_token"])
        self.assertTrue(first_cookie)
        self.assertIn("httponly", login_response.headers["set-cookie"].lower())

        refresh_response = client.post("/refresh")
        second_cookie = client.cookies.get(REFRESH_COOKIE_NAME)

        self.assertEqual(refresh_response.status_code, 200)
        self.assertNotEqual(first_cookie, second_cookie)
        self.assertEqual(
            self.db.query(RefreshSession).filter(RefreshSession.user_id == self.user.id).count(),
            2,
        )

        logout_response = client.post("/logout")
        self.assertEqual(logout_response.status_code, 200)
        self.assertIsNone(client.cookies.get(REFRESH_COOKIE_NAME))
        self.assertEqual(client.post("/refresh").status_code, 401)


if __name__ == "__main__":
    unittest.main()

