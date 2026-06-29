from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import SessionLocal
from models.user import User
from utils.security import ALGORITHM, SECRET_KEY

router = APIRouter(prefix="/subscription", tags=["Subscription"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

VALID_PLANS = {"STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"}


class SubscriptionActivation(BaseModel):
    plan: str
    paypal_subscription_id: str


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_email(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")

    return email


@router.post("/activate")
def activate_subscription(
    data: SubscriptionActivation,
    email: str = Depends(get_current_email),
    db: Session = Depends(get_db)
):
    if data.plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.plan = data.plan
    user.subscription_status = "active"
    user.paypal_subscription_id = data.paypal_subscription_id
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
