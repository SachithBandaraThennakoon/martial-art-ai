from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from auth_context import account_payload, get_current_user
from models.password_reset_token import PasswordResetToken
from models.privacy import ConsentRecord
from models.user import User
from services.password_reset_email import email_delivery_configured, send_password_reset_email
from services.refresh_sessions import (
    REFRESH_TOKEN_DAYS,
    issue_refresh_session,
    prune_expired_refresh_sessions,
    revoke_refresh_token,
    revoke_user_sessions,
    rotate_refresh_session,
)
from services.rate_limits import (
    FORGOT_PASSWORD_ACCOUNT,
    FORGOT_PASSWORD_IP,
    LOGIN_ACCOUNT,
    LOGIN_IP,
    REFRESH_IP,
    REFRESH_TOKEN,
    REGISTER_ACCOUNT,
    REGISTER_IP,
    RESET_PASSWORD_IP,
    RESET_PASSWORD_TOKEN,
    client_ip,
    enforce_rate_limits,
)
from services.privacy import AGE_POLICY_VERSION, PRIVACY_NOTICE_VERSION, TERMS_VERSION
from utils.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    hash_password,
    verify_password,
)

router = APIRouter()

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")
RESET_TOKEN_MINUTES = 30
RESET_RESPONSE = "If an account matches that email, a password reset link is on its way."
REFRESH_COOKIE_NAME = "martial_refresh"
COOKIE_SECURE = APP_ENV == "production"
COOKIE_SAMESITE = "none" if COOKIE_SECURE else "lax"
ALLOWED_BROWSER_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", FRONTEND_URL).split(",")
    if origin.strip()
}
ALLOWED_BROWSER_ORIGINS.add(FRONTEND_URL)

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


def _require_trusted_browser_origin(request: Request) -> None:
    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin and origin not in ALLOWED_BROWSER_ORIGINS:
        raise HTTPException(status_code=403, detail="Browser origin is not allowed")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _session_payload(user: User) -> dict:
    return {
        "access_token": create_access_token({
            "sub": str(user.id),
            "uid": user.id,
            "email": user.email,
        }),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **account_payload(user),
    }


@router.post("/register")
def register(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    privacy_version: str = Form(...),
    terms_version: str = Form(...),
    accept_privacy: bool = Form(...),
    accept_terms: bool = Form(...),
    confirm_minimum_age: bool = Form(...),
    db: Session = Depends(get_db)
):
    clean_name = " ".join(name.strip().split())
    clean_email = email.strip().lower()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (REGISTER_IP, client_ip(request)),
        (REGISTER_ACCOUNT, clean_email),
    )

    if len(clean_name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name")
    if "@" not in clean_email or "." not in clean_email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not accept_privacy or privacy_version != PRIVACY_NOTICE_VERSION:
        raise HTTPException(status_code=409, detail="Please review and accept the current privacy notice")
    if not accept_terms or terms_version != TERMS_VERSION:
        raise HTTPException(status_code=409, detail="Please review and accept the current terms")
    if not confirm_minimum_age:
        raise HTTPException(status_code=400, detail="You must confirm that you are at least 18 years old")

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
        trial_ends_at=_utcnow() + timedelta(days=3)
    )

    db.add(user)
    db.flush()
    db.add_all([
        ConsentRecord(user_id=user.id, document_type="privacy_notice", document_version=PRIVACY_NOTICE_VERSION, source="registration"),
        ConsentRecord(user_id=user.id, document_type="terms", document_version=TERMS_VERSION, source="registration"),
        ConsentRecord(user_id=user.id, document_type="age_policy", document_version=AGE_POLICY_VERSION, source="registration"),
    ])
    db.commit()

    return {"message": "User created successfully"}


@router.post("/login")
def login(
    response: Response,
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    _require_trusted_browser_origin(request)
    clean_email = email.strip().lower()
    enforce_rate_limits(
        db,
        (LOGIN_IP, client_ip(request)),
        (LOGIN_ACCOUNT, clean_email),
    )
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    prune_expired_refresh_sessions(db)
    refresh_token, _session = issue_refresh_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    return _session_payload(user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return account_payload(user)


@router.post("/refresh")
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_trusted_browser_origin(request)
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    enforce_rate_limits(
        db,
        (REFRESH_IP, client_ip(request)),
        (REFRESH_TOKEN, raw_token or "missing"),
    )
    if not raw_token:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh session is required")

    try:
        replacement_token, _replacement, user = rotate_refresh_session(
            db,
            raw_token,
            user_agent=request.headers.get("user-agent"),
        )
    except HTTPException:
        _clear_refresh_cookie(response)
        raise

    _set_refresh_cookie(response, replacement_token)
    return _session_payload(user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_trusted_browser_origin(request)
    revoke_refresh_token(db, request.cookies.get(REFRESH_COOKIE_NAME))
    db.commit()
    _clear_refresh_cookie(response)
    return {"message": "Signed out"}


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    clean_email = payload.email.strip().lower()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (FORGOT_PASSWORD_IP, client_ip(request)),
        (FORGOT_PASSWORD_ACCOUNT, clean_email),
    )
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
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    token = payload.token.strip()
    _require_trusted_browser_origin(request)
    enforce_rate_limits(
        db,
        (RESET_PASSWORD_IP, client_ip(request)),
        (RESET_PASSWORD_TOKEN, token or "missing"),
    )
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
    revoke_user_sessions(db, user.id, now)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    db.commit()

    return {"message": "Password updated. You can now sign in with your new password."}
