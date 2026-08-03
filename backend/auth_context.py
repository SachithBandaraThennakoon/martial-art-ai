from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import InvalidTokenError
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from utils.security import ALGORITHM, SECRET_KEY


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

PLAN_ORDER = {
    "FREE_PLAN": 0,
    "STARTER_PLAN": 1,
    "PRO_PLAN": 2,
    "ELITE_PLAN": 3,
}


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def normalize_plan(value: str | None) -> str:
    plan = (value or "FREE_PLAN").strip().upper()
    return plan if plan in PLAN_ORDER else "FREE_PLAN"


def effective_plan(user: User, now: datetime | None = None) -> str:
    """Return the plan the server will currently honor for this account."""
    if (user.role or "user").strip().lower() == "admin":
        return "ELITE_PLAN"

    plan = normalize_plan(user.plan)
    if plan == "FREE_PLAN":
        return plan

    current_time = _as_naive_utc(now) or _utcnow_naive()
    status = (user.subscription_status or "").strip().lower()
    subscription_ends_at = _as_naive_utc(user.subscription_ends_at)
    trial_ends_at = _as_naive_utc(user.trial_ends_at)

    if status == "active" and (
        subscription_ends_at is None or subscription_ends_at > current_time
    ):
        return plan
    if status == "trial" and trial_ends_at and trial_ends_at > current_time:
        return plan
    return "FREE_PLAN"


def can_access_plan(user: User, required_plan: str | None) -> bool:
    required = normalize_plan(required_plan)
    return PLAN_ORDER[effective_plan(user)] >= PLAN_ORDER[required]


def ensure_plan_access(user: User, required_plan: str | None) -> User:
    required = normalize_plan(required_plan)
    if not can_access_plan(user, required):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "plan_required",
                "message": f"{required.replace('_PLAN', '').title()} plan required",
                "required_plan": required,
                "effective_plan": effective_plan(user),
            },
        )
    return user


def account_payload(user: User) -> dict:
    current_plan = effective_plan(user)
    return {
        "id": user.id,
        "name": user.name or "",
        "email": user.email or "",
        "role": (user.role or "user").strip().lower(),
        "plan": current_plan,
        "configured_plan": normalize_plan(user.plan),
        "subscription_status": user.subscription_status or "inactive",
        "trial_ends_at": user.trial_ends_at.isoformat() if user.trial_ends_at else None,
        "subscription_ends_at": (
            user.subscription_ends_at.isoformat() if user.subscription_ends_at else None
        ),
    }


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    token_type = payload.get("type")
    if token_type not in {None, "access"}:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def get_user_from_token(db: Session, token: str) -> User:
    payload = decode_access_token(token)
    subject = str(payload.get("sub") or "").strip()
    user_id = payload.get("uid")

    if user_id is None and subject.isdigit():
        user_id = int(subject)

    user = None
    if user_id is not None:
        try:
            user = db.query(User).filter(User.id == int(user_id)).first()
        except (TypeError, ValueError):
            user = None

    # Compatibility path for access tokens issued before the immutable ID subject.
    email = str(payload.get("email") or (subject if "@" in subject else "")).strip().lower()
    if user is None and email:
        user = db.query(User).filter(func.lower(User.email) == email).first()

    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    return get_user_from_token(db, token)


def require_admin_user(user: User = Depends(get_current_user)) -> User:
    if (user.role or "user").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
