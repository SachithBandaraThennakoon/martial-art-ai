import json
import logging
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from services.observability import JsonFormatter, RedactionFilter


class ObservabilityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_liveness_does_not_depend_on_database(self):
        with patch(
            "main.database_readiness",
            return_value={
                "ready": False,
                "database": "unavailable",
                "migrations": "unknown",
                "latency_ms": 2.1,
            },
        ):
            response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "alive"})

    def test_readiness_returns_503_for_dependency_failure(self):
        with patch(
            "main.database_readiness",
            return_value={
                "ready": False,
                "database": "unavailable",
                "migrations": "unknown",
                "latency_ms": 2.1,
            },
        ):
            response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "not_ready")

    def test_request_id_is_validated_and_echoed(self):
        accepted = self.client.get("/health/live", headers={"X-Request-ID": "release-check-123"})
        replaced = self.client.get("/health/live", headers={"X-Request-ID": "bad value with spaces"})
        self.assertEqual(accepted.headers["X-Request-ID"], "release-check-123")
        self.assertEqual(len(replaced.headers["X-Request-ID"]), 32)

    def test_request_id_wraps_early_rate_limit_response(self):
        with patch(
            "main.enforce_rate_limits",
            side_effect=HTTPException(status_code=429, detail="Limited"),
        ):
            response = self.client.post("/subscription/checkout-context", json={})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(len(response.headers["X-Request-ID"]), 32)

    def test_json_logs_redact_tokens_emails_and_sas_signatures(self):
        record = logging.LogRecord(
            "test",
            logging.ERROR,
            __file__,
            1,
            "Bearer secret-token student@example.com sig=very-secret",
            (),
            None,
        )
        RedactionFilter().filter(record)
        payload = json.loads(JsonFormatter().format(record))
        self.assertNotIn("secret-token", payload["message"])
        self.assertNotIn("student@example.com", payload["message"])
        self.assertNotIn("very-secret", payload["message"])


if __name__ == "__main__":
    unittest.main()
