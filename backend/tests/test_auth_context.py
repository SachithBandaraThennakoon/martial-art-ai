import unittest
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth_context import (
    account_payload,
    can_access_plan,
    effective_plan,
    ensure_plan_access,
    get_current_user,
    get_user_from_token,
    require_admin_user,
)
from database import Base
from models.user import User
from routers.auth import router as auth_router
from utils.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    hash_password,
)


class AuthContextTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = User(
            name="Test Student",
            email="student@example.com",
            password_hash=hash_password("test-password"),
            role="user",
            plan="PRO_PLAN",
            subscription_status="active",
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_new_tokens_resolve_by_immutable_user_id(self):
        token = create_access_token({
            "sub": str(self.user.id),
            "uid": self.user.id,
            "email": self.user.email,
        })

        resolved = get_user_from_token(self.db, token)

        self.assertEqual(resolved.id, self.user.id)

    def test_access_token_lifetime_is_short_lived(self):
        token = create_access_token({"sub": str(self.user.id), "uid": self.user.id})
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        self.assertLessEqual(ACCESS_TOKEN_EXPIRE_MINUTES, 60)
        self.assertLessEqual(claims["exp"] - claims["iat"], 60 * 60)

    def test_legacy_email_subject_tokens_remain_valid_during_transition(self):
        token = create_access_token({"sub": self.user.email})

        resolved = get_user_from_token(self.db, token)

        self.assertEqual(resolved.id, self.user.id)

    def test_missing_account_is_rejected_even_when_token_is_signed(self):
        token = create_access_token({"sub": "999999", "uid": 999999})

        with self.assertRaises(HTTPException) as context:
            get_user_from_token(self.db, token)

        self.assertEqual(context.exception.status_code, 401)

    def test_expired_paid_access_falls_back_to_free(self):
        self.user.subscription_status = "cancelled"
        self.user.subscription_ends_at = (
            datetime.now(timezone.utc) - timedelta(minutes=1)
        ).replace(tzinfo=None)
        self.db.commit()

        self.assertEqual(effective_plan(self.user), "FREE_PLAN")
        self.assertFalse(can_access_plan(self.user, "STARTER_PLAN"))
        self.assertEqual(account_payload(self.user)["configured_plan"], "PRO_PLAN")

    def test_current_paid_trial_retains_its_configured_plan(self):
        self.user.subscription_status = "trial"
        self.user.trial_ends_at = (
            datetime.now(timezone.utc) + timedelta(days=1)
        ).replace(tzinfo=None)
        self.db.commit()

        self.assertEqual(effective_plan(self.user), "PRO_PLAN")
        self.assertTrue(can_access_plan(self.user, "STARTER_PLAN"))

    def test_plan_denial_has_machine_readable_detail(self):
        self.user.plan = "FREE_PLAN"
        self.user.subscription_status = "trial"
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            ensure_plan_access(self.user, "PRO_PLAN")

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail["code"], "plan_required")
        self.assertEqual(context.exception.detail["effective_plan"], "FREE_PLAN")

    def test_admin_role_bypasses_plan_tiers(self):
        self.user.role = "admin"
        self.user.plan = "FREE_PLAN"
        self.user.subscription_status = "inactive"
        self.db.commit()

        self.assertEqual(effective_plan(self.user), "ELITE_PLAN")
        self.assertIs(require_admin_user(self.user), self.user)
        self.assertTrue(can_access_plan(self.user, "ELITE_PLAN"))

    def test_non_admin_is_denied_admin_access(self):
        with self.assertRaises(HTTPException) as context:
            require_admin_user(self.user)

        self.assertEqual(context.exception.status_code, 403)

    def test_me_returns_server_owned_effective_account_state(self):
        app = FastAPI()
        app.include_router(auth_router)
        app.dependency_overrides[get_current_user] = lambda: self.user

        response = TestClient(app).get("/me")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], self.user.id)
        self.assertEqual(response.json()["plan"], "PRO_PLAN")
        self.assertEqual(response.json()["role"], "user")


if __name__ == "__main__":
    unittest.main()
