from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import json
import os
import secrets

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.billing import BillingSubscription
from models.user import User
from utils.security import SECRET_KEY


VALID_PLANS = {"STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"}
PAYPAL_PLAN_IDS = {
    "STARTER_PLAN": os.getenv("PAYPAL_STARTER_PLAN_ID", "").strip(),
    "PRO_PLAN": os.getenv("PAYPAL_PRO_PLAN_ID", "").strip(),
    "ELITE_PLAN": os.getenv("PAYPAL_ELITE_PLAN_ID", "").strip(),
}
PLAN_BY_PROVIDER_ID = {
    provider_id: plan for plan, provider_id in PAYPAL_PLAN_IDS.items() if provider_id
}
_PLAN_REFERENCE_CODES = {
    "STARTER_PLAN": "s",
    "PRO_PLAN": "p",
    "ELITE_PLAN": "e",
}


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_provider_time(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def issue_checkout_reference(user: User, plan: str) -> str:
    expires_at = int((datetime.now(timezone.utc) + timedelta(minutes=10)).timestamp())
    nonce = secrets.token_urlsafe(8)
    unsigned = f"v1.{user.id}.{_PLAN_REFERENCE_CODES[plan]}.{expires_at}.{nonce}"
    signature = base64.urlsafe_b64encode(
        hmac.new(SECRET_KEY.encode("utf-8"), unsigned.encode("utf-8"), hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    return f"{unsigned}.{signature}"


def verify_checkout_reference(reference: str, user: User, plan: str) -> None:
    try:
        version, user_id, plan_code, expires_at, nonce, signature = reference.split(".")
        unsigned = ".".join((version, user_id, plan_code, expires_at, nonce))
        expected_signature = base64.urlsafe_b64encode(
            hmac.new(
                SECRET_KEY.encode("utf-8"),
                unsigned.encode("utf-8"),
                hashlib.sha256,
            ).digest()
        ).rstrip(b"=").decode("ascii")
        valid = (
            version == "v1"
            and int(user_id) == int(user.id)
            and plan_code == _PLAN_REFERENCE_CODES[plan]
            and int(expires_at) >= int(datetime.now(timezone.utc).timestamp())
            and hmac.compare_digest(signature, expected_signature)
        )
    except (KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise HTTPException(
            status_code=400,
            detail="PayPal checkout is not linked to this account and plan",
        )


def canonical_payload_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def extract_subscription_id(event: dict) -> str | None:
    resource = event.get("resource") or {}
    event_type = str(event.get("event_type") or "")
    if event_type.startswith("BILLING.SUBSCRIPTION."):
        return str(resource.get("id") or "").strip() or None
    candidates = [
        resource.get("billing_agreement_id"),
        ((resource.get("supplementary_data") or {}).get("related_ids") or {}).get(
            "subscription_id"
        ),
    ]
    return next((str(value).strip() for value in candidates if value), None)


def _has_payment_problem(details: dict) -> bool:
    billing_info = details.get("billing_info") or {}
    failed_count = int(billing_info.get("failed_payments_count") or 0)
    outstanding = (billing_info.get("outstanding_balance") or {}).get("value")
    try:
        has_outstanding = float(outstanding or 0) > 0
    except (TypeError, ValueError):
        has_outstanding = False
    return failed_count > 0 or has_outstanding


def apply_provider_subscription(
    db: Session,
    record: BillingSubscription,
    user: User,
    details: dict,
    *,
    event_type: str | None = None,
) -> None:
    now = utcnow_naive()
    provider_plan_id = str(details.get("plan_id") or "").strip()
    internal_plan = PLAN_BY_PROVIDER_ID.get(provider_plan_id)
    provider_status = str(details.get("status") or "").strip().upper()
    status_map = {
        "APPROVAL_PENDING": "pending",
        "APPROVED": "pending",
        "ACTIVE": "active",
        "SUSPENDED": "suspended",
        "CANCELLED": "cancelled",
        "EXPIRED": "expired",
    }
    status = status_map.get(provider_status, "unknown")
    needs_review = internal_plan is None or status == "unknown"

    if event_type == "BILLING.SUBSCRIPTION.PAYMENT.FAILED" or (
        status == "active" and _has_payment_problem(details)
    ):
        status = "payment_failed"
        record.last_failed_payment_at = now
    elif event_type in {"PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"}:
        status = "payment_reversed"
        needs_review = True
    elif event_type == "PAYMENT.SALE.COMPLETED" and status == "active":
        record.last_payment_at = parse_provider_time(details.get("status_update_time")) or now

    record.provider_plan_id = provider_plan_id or record.provider_plan_id
    if internal_plan:
        record.internal_plan = internal_plan
    record.status = status
    record.needs_review = needs_review
    record.status_updated_at = parse_provider_time(details.get("status_update_time")) or now
    record.last_reconciled_at = now

    if user.paypal_subscription_id == record.provider_subscription_id:
        if internal_plan:
            user.plan = internal_plan
        user.subscription_status = status
        if status == "active" and internal_plan:
            user.subscription_ends_at = None
            user.trial_ends_at = None

    db.add(record)
    db.add(user)


def upsert_activation(
    db: Session,
    user: User,
    subscription_id: str,
    plan: str,
    details: dict,
) -> BillingSubscription:
    record = db.query(BillingSubscription).filter(
        BillingSubscription.provider_subscription_id == subscription_id
    ).first()
    if record and record.user_id != user.id:
        raise HTTPException(status_code=409, detail="Subscription is already linked to another account")
    if not record:
        record = BillingSubscription(
            user_id=user.id,
            provider="paypal",
            provider_subscription_id=subscription_id,
            provider_plan_id=PAYPAL_PLAN_IDS[plan],
            internal_plan=plan,
            status="active",
        )
    user.paypal_subscription_id = subscription_id
    apply_provider_subscription(db, record, user, details)
    return record
