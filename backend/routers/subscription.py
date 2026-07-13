from datetime import datetime
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from utils.security import ALGORITHM, SECRET_KEY
from utils.config import PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE

router = APIRouter(prefix="/subscription", tags=["Subscription"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

VALID_PLANS = {"STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"}
PAYPAL_API_BASE = (
    "https://api-m.paypal.com"
    if PAYPAL_MODE == "live"
    else "https://api-m.sandbox.paypal.com"
)
PAYPAL_PLAN_IDS = {
    "STARTER_PLAN": os.getenv("PAYPAL_STARTER_PLAN_ID"),
    "PRO_PLAN": os.getenv("PAYPAL_PRO_PLAN_ID"),
    "ELITE_PLAN": os.getenv("PAYPAL_ELITE_PLAN_ID"),
}


class SubscriptionActivation(BaseModel):
    plan: str
    paypal_subscription_id: str


def get_current_email(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")

    return email


async def verify_paypal_subscription(subscription_id: str, expected_plan: str):
    expected_plan_id = PAYPAL_PLAN_IDS.get(expected_plan)
    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET or not expected_plan_id:
        raise HTTPException(status_code=503, detail="Subscription verification is not configured")

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            token_response = await client.post(
                f"{PAYPAL_API_BASE}/v1/oauth2/token",
                auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
                data={"grant_type": "client_credentials"},
                headers={"Accept": "application/json"},
            )
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            if not access_token:
                raise HTTPException(status_code=503, detail="Payment verification is unavailable")

            subscription_response = await client.get(
                f"{PAYPAL_API_BASE}/v1/billing/subscriptions/{subscription_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if subscription_response.status_code == 404:
                raise HTTPException(status_code=400, detail="PayPal subscription was not found")
            subscription_response.raise_for_status()
            subscription = subscription_response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=503, detail="Payment verification is temporarily unavailable")

    if subscription.get("plan_id") != expected_plan_id:
        raise HTTPException(status_code=400, detail="Subscription does not match the selected plan")
    if subscription.get("status") != "ACTIVE":
        raise HTTPException(status_code=400, detail="PayPal subscription is not active")

    return subscription


@router.post("/activate")
async def activate_subscription(
    data: SubscriptionActivation,
    email: str = Depends(get_current_email),
    db: Session = Depends(get_db)
):
    plan = data.plan.strip().upper()
    paypal_subscription_id = data.paypal_subscription_id.strip()

    if plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")

    if not paypal_subscription_id:
        raise HTTPException(status_code=400, detail="PayPal subscription ID is required")

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_owner = db.query(User).filter(
        User.paypal_subscription_id == paypal_subscription_id,
        User.id != user.id,
    ).first()
    if existing_owner:
        raise HTTPException(status_code=409, detail="Subscription is already linked to another account")

    await verify_paypal_subscription(paypal_subscription_id, plan)

    user.plan = plan
    user.subscription_status = "active"
    user.paypal_subscription_id = paypal_subscription_id
    user.subscription_ends_at = None
    user.trial_ends_at = None

    db.add(user)
    db.commit()

    return {
        "message": "Subscription activated",
        "plan": user.plan,
        "subscription_status": user.subscription_status,
        "activated_at": datetime.utcnow().isoformat()
    }
