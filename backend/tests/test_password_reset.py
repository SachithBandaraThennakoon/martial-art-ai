import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
from models.password_reset_token import PasswordResetToken
from models.user import User
from routers.auth import ForgotPasswordRequest, ResetPasswordRequest, forgot_password, reset_password
from utils.security import hash_password, verify_password


class PasswordResetFlowTests(unittest.TestCase):
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
            password_hash=hash_password("old-password"),
        )
        self.db.add(self.user)
        self.db.commit()
        self.request = Request({
            "type": "http",
            "client": ("127.0.0.42", 5000),
            "headers": [],
        })

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    @patch("routers.auth.send_password_reset_email", return_value=False)
    def test_reset_token_is_hashed_single_use_and_changes_password(self, _send_email):
        response = forgot_password(
            ForgotPasswordRequest(email="student@example.com"),
            self.request,
            self.db,
        )
        reset_url = response["development_reset_url"]
        raw_token = parse_qs(urlparse(reset_url).query)["token"][0]
        stored = self.db.query(PasswordResetToken).one()

        self.assertNotEqual(stored.token_hash, raw_token)
        self.assertEqual(len(stored.token_hash), 64)

        result = reset_password(
            ResetPasswordRequest(token=raw_token, password="new-password"),
            self.db,
        )
        self.assertIn("Password updated", result["message"])
        self.db.refresh(self.user)
        self.assertTrue(verify_password("new-password", self.user.password_hash))

        with self.assertRaises(HTTPException):
            reset_password(
                ResetPasswordRequest(token=raw_token, password="another-password"),
                self.db,
            )

    def test_unknown_email_uses_generic_response(self):
        response = forgot_password(
            ForgotPasswordRequest(email="missing@example.com"),
            Request({"type": "http", "client": ("127.0.0.43", 5000), "headers": []}),
            self.db,
        )

        self.assertNotIn("development_reset_url", response)
        self.assertIn("If an account matches", response["message"])


if __name__ == "__main__":
    unittest.main()
