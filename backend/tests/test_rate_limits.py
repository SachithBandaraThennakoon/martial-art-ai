import unittest
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models.rate_limit_bucket import RateLimitBucket
from routers.auth import router as auth_router
from services.rate_limits import RateLimitRule, enforce_rate_limits, hash_subject


class SharedRateLimitTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.now = datetime(2026, 8, 3, 12, 0, 5)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_limit_is_shared_between_database_sessions(self):
        rule = RateLimitRule("test-shared", 2, 60)
        second_worker = self.Session()
        try:
            enforce_rate_limits(self.db, (rule, "203.0.113.1"), now=self.now)
            enforce_rate_limits(second_worker, (rule, "203.0.113.1"), now=self.now)

            with self.assertRaises(HTTPException) as context:
                enforce_rate_limits(self.db, (rule, "203.0.113.1"), now=self.now)
            self.assertEqual(context.exception.status_code, 429)
            self.assertGreaterEqual(int(context.exception.headers["Retry-After"]), 1)
        finally:
            second_worker.close()

    def test_stored_subject_is_keyed_hash_not_raw_identifier(self):
        rule = RateLimitRule("test-hash", 1, 60)
        subject = "Student@Example.com"
        enforce_rate_limits(self.db, (rule, subject), now=self.now)

        bucket = self.db.query(RateLimitBucket).one()
        self.assertEqual(bucket.subject_hash, hash_subject(subject))
        self.assertNotIn("student", bucket.subject_hash)
        self.assertEqual(len(bucket.subject_hash), 64)

    def test_subjects_and_windows_are_independent(self):
        rule = RateLimitRule("test-window", 1, 60)
        enforce_rate_limits(self.db, (rule, "first"), now=self.now)
        enforce_rate_limits(self.db, (rule, "second"), now=self.now)
        enforce_rate_limits(
            self.db,
            (rule, "first"),
            now=self.now + timedelta(seconds=60),
        )

        self.assertEqual(self.db.query(RateLimitBucket).count(), 3)

    def test_auth_endpoint_returns_retry_after_when_limited(self):
        app = FastAPI()
        app.include_router(auth_router)

        def override_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_db
        client = TestClient(app)
        responses = [
            client.post("/forgot-password", json={"email": "same@example.com"})
            for _ in range(4)
        ]

        self.assertTrue(all(response.status_code == 200 for response in responses[:3]))
        self.assertEqual(responses[3].status_code, 429)
        self.assertGreaterEqual(int(responses[3].headers["retry-after"]), 1)
        self.assertEqual(responses[3].headers["x-ratelimit-code"], "rate_limited")
        self.assertIn("Too many requests", responses[3].json()["detail"])


if __name__ == "__main__":
    unittest.main()
