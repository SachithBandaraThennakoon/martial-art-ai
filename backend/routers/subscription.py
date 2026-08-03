from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth_context import account_payload, get_current_user
from database import get_db
from models.billing import BillingEvent, BillingSubscription
from models.user import User
from services.billing import (
    PAYPAL_PLAN_IDS,
    VALID_PLANS,
    apply_provider_subscription,
    canonical_payload_hash,
    extract_subscription_id,
    issue_checkout_reference,
    upsert_activation,
    utcnow_naive,
    verify_checkout_reference,
)
from services.paypal_client import PayPalAPIError, get_subscription, verify_webhook_signature
from services.rate_limits import SUBSCRIPTION_USER, enforce_rate_limits


router = APIRouter(prefix="/subscription", tags=["Subscription"])

SUPPORTED_EVENTS = {
    "PAYMENT.SALE.COMPLETED",
    "PAYMENT.SALE.REFUNDED",
    "PAYMENT.SALE.REVERSED",
    "BILLING.SUBSCRIPTION.CREATED",
    "BILLING.SUBSCRIPTION.ACTIVATED",
    "BILLING.SUBSCRIPTION.UPDATED",
    "BILLING.SUBSCRIPTION.EXPIRED",
    "BILLING.SUBSCRIPTION.CANCELLED",
    "BILLING.SUBSCRIPTION.SUSPENDED",
    "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
}


class CheckoutContextRequest(BaseModel):
    plan: str


class SubscriptionActivation(BaseModel):
    plan: str
    paypal_subscription_id: str


def _validated_plan(value: str) -> str:
    plan = value.strip().upper()
    if plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")
    if not PAYPAL_PLAN_IDS.get(plan):
        raise HTTPException(status_code=503, detail="Subscription checkout is not configured")
    return plan


@router.post("/checkout-context")
def create_checkout_context(
    data: CheckoutContextRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    enforce_rate_limits(db, (SUBSCRIPTION_USER, str(user.id)))
    plan = _validated_plan(data.plan)
    return {
        "plan": plan,
        "plan_id": PAYPAL_PLAN_IDS[plan],
        "custom_id": issue_checkout_reference(user, plan),
        "expires_in": 600,
    }


@router.post("/activate")
async def activate_subscription(
    data: SubscriptionActivation,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    enforce_rate_limits(db, (SUBSCRIPTION_USER, str(user.id)))
    plan = _validated_plan(data.plan)
    subscription_id = data.paypal_subscription_id.strip()
    if not subscription_id:
        raise HTTPException(status_code=400, detail="PayPal subscription ID is required")

    try:
        details = await get_subscription(subscription_id)
    except PayPalAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if details.get("plan_id") != PAYPAL_PLAN_IDS[plan]:
        raise HTTPException(status_code=400, detail="Subscription does not match the selected plan")
    if details.get("status") != "ACTIVE":
        raise HTTPException(status_code=400, detail="PayPal subscription is not active")
    verify_checkout_reference(str(details.get("custom_id") or ""), user, plan)

    try:
        upsert_activation(db, user, subscription_id, plan, details)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Subscription is already linked to another account",
        ) from exc

    return {
        "message": "Subscription activated",
        "plan": user.plan,
        "subscription_status": user.subscription_status,
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "account": account_payload(user),
    }


@router.post("/webhooks/paypal")
async def paypal_webhook(request: Request, db: Session = Depends(get_db)):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > 1024 * 1024:
        raise HTTPException(status_code=413, detail="Webhook payload is too large")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 1024 * 1024:
            raise HTTPException(status_code=413, detail="Webhook payload is too large")
    try:
        event = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Webhook body must be valid JSON") from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Webhook body must be an object")

    event_id = str(event.get("id") or "").strip()
    event_type = str(event.get("event_type") or "").strip()
    if not event_id or len(event_id) > 128 or not event_type or len(event_type) > 96:
        raise HTTPException(status_code=400, detail="Webhook event metadata is invalid")

    try:
        verified = await verify_webhook_signature(request.headers, event)
    except PayPalAPIError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not verified:
        raise HTTPException(status_code=400, detail="Webhook signature verification failed")

    payload_hash = canonical_payload_hash(event)
    existing = db.query(BillingEvent).filter(
        BillingEvent.provider_event_id == event_id
    ).first()
    if existing:
        if existing.payload_hash != payload_hash:
            raise HTTPException(status_code=409, detail="Webhook event ID payload mismatch")
        if existing.processing_status in {"processed", "ignored"}:
            return {"received": True, "duplicate": True}
        billing_event = existing
    else:
        resource = event.get("resource") or {}
        billing_event = BillingEvent(
            provider_event_id=event_id,
            event_type=event_type,
            provider_subscription_id=extract_subscription_id(event),
            provider_resource_id=str(resource.get("id") or "")[:128] or None,
            payload_hash=payload_hash,
            verification_status="verified",
            processing_status="received",
        )
        db.add(billing_event)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            concurrent = db.query(BillingEvent).filter(
                BillingEvent.provider_event_id == event_id
            ).first()
            if concurrent and concurrent.payload_hash == payload_hash:
                return {"received": True, "duplicate": True}
            raise HTTPException(status_code=409, detail="Webhook event conflict")

    if event_type not in SUPPORTED_EVENTS:
        billing_event.processing_status = "ignored"
        billing_event.processed_at = utcnow_naive()
        db.commit()
        return {"received": True, "ignored": True}

    subscription_id = billing_event.provider_subscription_id
    record = db.query(BillingSubscription).filter(
        BillingSubscription.provider_subscription_id == subscription_id
    ).first()
    if not record:
        billing_event.processing_status = "ignored"
        billing_event.error_code = "unknown_subscription"
        billing_event.processed_at = utcnow_naive()
        db.commit()
        return {"received": True, "ignored": True}

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        billing_event.processing_status = "failed"
        billing_event.error_code = "user_missing"
        db.commit()
        raise HTTPException(status_code=503, detail="Billing account is unavailable")

    try:
        details = await get_subscription(subscription_id)
        apply_provider_subscription(
            db,
            record,
            user,
            details,
            event_type=event_type,
        )
        billing_event.processing_status = "processed"
        billing_event.error_code = None
        billing_event.processed_at = utcnow_naive()
        db.commit()
    except PayPalAPIError as exc:
        db.rollback()
        billing_event = db.query(BillingEvent).filter(
            BillingEvent.provider_event_id == event_id
        ).first()
        billing_event.processing_status = "failed"
        billing_event.error_code = "provider_unavailable"
        db.commit()
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"received": True, "processed": True}
