import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from auth_context import get_current_user
from database import Base, get_db
from models.billing import BillingEvent, BillingSubscription
from models.user import User
from routers.subscription import router
from services.billing import (
    PAYPAL_PLAN_IDS,
    PLAN_BY_PROVIDER_ID,
    issue_checkout_reference,
    verify_checkout_reference,
)


class BillingLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.user = User(
            name="Billing Student",
            email="billing@example.com",
            password_hash="not-used",
            role="user",
            plan="FREE_PLAN",
            subscription_status="inactive",
        )
        self.other_user = User(
            name="Other Student",
            email="other@example.com",
            password_hash="not-used",
            role="user",
            plan="FREE_PLAN",
            subscription_status="inactive",
        )
        self.db.add_all([self.user, self.other_user])
        self.db.commit()

        self.old_plan_id = PAYPAL_PLAN_IDS.get("PRO_PLAN")
        PAYPAL_PLAN_IDS["PRO_PLAN"] = "P-TEST-PRO"
        PLAN_BY_PROVIDER_ID["P-TEST-PRO"] = "PRO_PLAN"

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.rate_limit_patch = patch("routers.subscription.enforce_rate_limits")
        self.rate_limit_patch.start()

    def tearDown(self):
        self.rate_limit_patch.stop()
        if self.old_plan_id:
            PAYPAL_PLAN_IDS["PRO_PLAN"] = self.old_plan_id
        else:
            PAYPAL_PLAN_IDS["PRO_PLAN"] = ""
        PLAN_BY_PROVIDER_ID.pop("P-TEST-PRO", None)
        self.db.close()
        self.engine.dispose()

    def subscription_details(self, custom_id=None, status="ACTIVE"):
        return {
            "id": "I-TEST-SUB",
            "plan_id": "P-TEST-PRO",
            "status": status,
            "custom_id": custom_id or issue_checkout_reference(self.user, "PRO_PLAN"),
            "status_update_time": "2026-08-03T10:00:00Z",
            "billing_info": {"failed_payments_count": 0},
        }

    def attach_subscription(self):
        self.user.paypal_subscription_id = "I-TEST-SUB"
        self.user.plan = "PRO_PLAN"
        self.user.subscription_status = "active"
        record = BillingSubscription(
            user_id=self.user.id,
            provider="paypal",
            provider_subscription_id="I-TEST-SUB",
            provider_plan_id="P-TEST-PRO",
            internal_plan="PRO_PLAN",
            status="active",
        )
        self.db.add(record)
        self.db.commit()
        return record

    def test_checkout_context_is_bound_to_user_and_plan(self):
        response = self.client.post("/subscription/checkout-context", json={"plan": "PRO_PLAN"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["plan_id"], "P-TEST-PRO")
        self.assertLessEqual(len(payload["custom_id"]), 127)
        verify_checkout_reference(payload["custom_id"], self.user, "PRO_PLAN")
        with self.assertRaises(Exception):
            verify_checkout_reference(payload["custom_id"], self.other_user, "PRO_PLAN")

    def test_activation_rejects_checkout_reference_for_another_user(self):
        details = self.subscription_details(
            custom_id=issue_checkout_reference(self.other_user, "PRO_PLAN")
        )
        with patch(
            "routers.subscription.get_subscription",
            new=AsyncMock(return_value=details),
        ):
            response = self.client.post(
                "/subscription/activate",
                json={"plan": "PRO_PLAN", "paypal_subscription_id": "I-TEST-SUB"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.user.paypal_subscription_id)

    def test_activation_links_verified_subscription_and_billing_record(self):
        with patch(
            "routers.subscription.get_subscription",
            new=AsyncMock(return_value=self.subscription_details()),
        ):
            response = self.client.post(
                "/subscription/activate",
                json={"plan": "PRO_PLAN", "paypal_subscription_id": "I-TEST-SUB"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["account"]["plan"], "PRO_PLAN")
        record = self.db.query(BillingSubscription).one()
        self.assertEqual(record.user_id, self.user.id)
        self.assertEqual(record.status, "active")

    def test_invalid_webhook_signature_is_rejected_without_storage(self):
        event = self.webhook_event("WH-INVALID", "BILLING.SUBSCRIPTION.CANCELLED")
        with patch(
            "routers.subscription.verify_webhook_signature",
            new=AsyncMock(return_value=False),
        ):
            response = self.client.post("/subscription/webhooks/paypal", json=event)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.query(BillingEvent).count(), 0)

    def test_duplicate_event_is_idempotent(self):
        self.attach_subscription()
        event = self.webhook_event("WH-DUPLICATE", "BILLING.SUBSCRIPTION.UPDATED")
        with (
            patch(
                "routers.subscription.verify_webhook_signature",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "routers.subscription.get_subscription",
                new=AsyncMock(return_value=self.subscription_details()),
            ) as lookup,
        ):
            first = self.client.post("/subscription/webhooks/paypal", json=event)
            second = self.client.post("/subscription/webhooks/paypal", json=event)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), {"received": True, "duplicate": True})
        self.assertEqual(lookup.await_count, 1)
        self.assertEqual(self.db.query(BillingEvent).count(), 1)

    def test_stale_cancellation_event_cannot_override_current_active_state(self):
        record = self.attach_subscription()
        event = self.webhook_event("WH-STALE", "BILLING.SUBSCRIPTION.CANCELLED")
        with (
            patch(
                "routers.subscription.verify_webhook_signature",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "routers.subscription.get_subscription",
                new=AsyncMock(return_value=self.subscription_details(status="ACTIVE")),
            ),
        ):
            response = self.client.post("/subscription/webhooks/paypal", json=event)
        self.db.refresh(record)
        self.db.refresh(self.user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(record.status, "active")
        self.assertEqual(self.user.subscription_status, "active")

    def test_payment_failure_removes_effective_paid_access(self):
        record = self.attach_subscription()
        event = self.webhook_event(
            "WH-FAILED", "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
        )
        with (
            patch(
                "routers.subscription.verify_webhook_signature",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "routers.subscription.get_subscription",
                new=AsyncMock(return_value=self.subscription_details(status="ACTIVE")),
            ),
        ):
            response = self.client.post("/subscription/webhooks/paypal", json=event)
        self.db.refresh(record)
        self.db.refresh(self.user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(record.status, "payment_failed")
        self.assertEqual(self.user.subscription_status, "payment_failed")

    def test_unknown_subscription_is_recorded_and_ignored(self):
        event = self.webhook_event("WH-UNKNOWN", "BILLING.SUBSCRIPTION.ACTIVATED")
        with patch(
            "routers.subscription.verify_webhook_signature",
            new=AsyncMock(return_value=True),
        ):
            response = self.client.post("/subscription/webhooks/paypal", json=event)
        self.assertEqual(response.status_code, 200)
        stored = self.db.query(BillingEvent).one()
        self.assertEqual(stored.processing_status, "ignored")
        self.assertEqual(stored.error_code, "unknown_subscription")

    @staticmethod
    def webhook_event(event_id, event_type):
        return {
            "id": event_id,
            "event_type": event_type,
            "resource": {"id": "I-TEST-SUB"},
        }


if __name__ == "__main__":
    unittest.main()
