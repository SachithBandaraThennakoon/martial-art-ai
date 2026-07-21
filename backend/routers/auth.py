from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
from threading import Lock
import time

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from models.password_reset_token import PasswordResetToken
from models.user import User
from services.password_reset_email import email_delivery_configured, send_password_reset_email
from utils.security import hash_password, verify_password, create_access_token

router = APIRouter()

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")
RESET_TOKEN_MINUTES = 30
RESET_REQUEST_LIMIT = 5
RESET_REQUEST_WINDOW_SECONDS = 15 * 60
RESET_RESPONSE = "If an account matches that email, a password reset link is on its way."

_reset_requests = defaultdict(deque)
_reset_requests_lock = Lock()


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


def _valid_email(value: str) -> bool:
    return "@" in value and "." in value.rsplit("@", 1)[-1]


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _allow_reset_request(client_key: str) -> bool:
    now = time.monotonic()
    with _reset_requests_lock:
        attempts = _reset_requests[client_key]
        while attempts and now - attempts[0] > RESET_REQUEST_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= RESET_REQUEST_LIMIT:
            return False
        attempts.append(now)
    return True


@router.post("/register")
def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    clean_name = " ".join(name.strip().split())
    clean_email = email.strip().lower()

    if len(clean_name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name")
    if "@" not in clean_email or "." not in clean_email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing_user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=clean_name,
        email=clean_email,
        password_hash=hash_password(password),
        role="user",
        plan="FREE_PLAN",
        subscription_status="trial",
        trial_ends_at=datetime.utcnow() + timedelta(days=3)
    )

    db.add(user)
    db.commit()

    return {"message": "User created successfully"}


@router.post("/login")
def login(
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    clean_email = email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token({"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "plan": user.plan or "FREE_PLAN",
        "subscription_status": user.subscription_status or "trial",
        "role": user.role or "user",
        "name": user.name or ""
    }


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_key = request.client.host if request.client else "unknown"
    if not _allow_reset_request(client_key):
        raise HTTPException(
            status_code=429,
            detail="Too many reset requests. Please wait before trying again.",
        )

    clean_email = payload.email.strip().lower()
    response = {"message": RESET_RESPONSE}

    # Invalid and unknown addresses receive the same response to avoid account enumeration.
    if not _valid_email(clean_email):
        return response

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if not user:
        return response

    now = _utcnow()
    db.query(PasswordResetToken).filter(
        or_(
            PasswordResetToken.expires_at < now,
            PasswordResetToken.used_at.isnot(None),
        )
    ).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)

    raw_token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(raw_token),
        expires_at=now + timedelta(minutes=RESET_TOKEN_MINUTES),
    )
    db.add(reset_token)
    db.commit()

    reset_url = f"{FRONTEND_URL}/reset-password?token={raw_token}"
    delivered = send_password_reset_email(clean_email, reset_url)

    # Local development remains testable without exposing reset tokens in production.
    if APP_ENV != "production" and not email_delivery_configured() and not delivered:
        response["development_reset_url"] = reset_url

    return response


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    now = _utcnow()
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == _token_hash(token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at >= now,
    ).first()

    if not reset_token:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        reset_token.used_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")

    user.password_hash = hash_password(payload.password)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    db.commit()

    return {"message": "Password updated. You can now sign in with your new password."}
