from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
from threading import Lock
import time

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.rate_limit_bucket import RateLimitBucket
from utils.security import APP_ENV, SECRET_KEY


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitRule:
    scope: str
    limit: int
    window_seconds: int


def _positive_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, value)


GLOBAL_WRITE_IP = RateLimitRule(
    "http-write-ip",
    _positive_int("RATE_LIMIT_WRITE_REQUESTS", 300),
    _positive_int("RATE_LIMIT_WRITE_WINDOW_SECONDS", 300),
)
REGISTER_IP = RateLimitRule("register-ip", 5, 3600)
REGISTER_ACCOUNT = RateLimitRule("register-account", 3, 3600)
LOGIN_IP = RateLimitRule("login-ip", 30, 900)
LOGIN_ACCOUNT = RateLimitRule("login-account", 10, 900)
REFRESH_IP = RateLimitRule("refresh-ip", 120, 900)
REFRESH_TOKEN = RateLimitRule("refresh-token", 30, 900)
FORGOT_PASSWORD_IP = RateLimitRule("forgot-password-ip", 5, 900)
FORGOT_PASSWORD_ACCOUNT = RateLimitRule("forgot-password-account", 3, 900)
RESET_PASSWORD_IP = RateLimitRule("reset-password-ip", 10, 900)
RESET_PASSWORD_TOKEN = RateLimitRule("reset-password-token", 5, 900)
CONTACT_IP = RateLimitRule("contact-ip", 5, 3600)
CONTACT_ACCOUNT = RateLimitRule("contact-account", 3, 3600)
SUBSCRIPTION_USER = RateLimitRule("subscription-user", 10, 3600)
ACCOUNT_PRIVACY_USER = RateLimitRule("account-privacy-user", 5, 3600)
TAPE_UPLOAD_USER = RateLimitRule("tape-upload-user", 30, 3600)
WEBSOCKET_CONNECT_IP = RateLimitRule("websocket-connect-ip", 30, 300)
WEBSOCKET_CONNECT_USER = RateLimitRule("websocket-connect-user", 10, 300)

_HASH_SECRET = os.getenv("RATE_LIMIT_HASH_KEY", "").strip() or SECRET_KEY
if APP_ENV == "production" and len(_HASH_SECRET) < 32:
    raise RuntimeError("RATE_LIMIT_HASH_KEY must contain at least 32 characters in production")
_HASH_KEY = _HASH_SECRET.encode("utf-8")
_cleanup_lock = Lock()
_last_cleanup = 0.0
_development_buckets: dict[tuple[str, str, int], int] = {}
_development_lock = Lock()


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def client_ip(connection) -> str:
    """Use the address normalized by Uvicorn's trusted proxy configuration."""
    client = getattr(connection, "client", None)
    return str(client.host) if client and client.host else "unknown"


def hash_subject(value: str) -> str:
    normalized = (value or "unknown").strip().lower().encode("utf-8")
    return hmac.new(_HASH_KEY, normalized, hashlib.sha256).hexdigest()


def _increment_bucket(
    db: Session,
    rule: RateLimitRule,
    subject: str,
    now: datetime,
) -> tuple[int, int]:
    now_epoch = int(now.replace(tzinfo=timezone.utc).timestamp())
    window_start = now_epoch - (now_epoch % rule.window_seconds)
    retry_after = max(1, window_start + rule.window_seconds - now_epoch)
    values = {
        "scope": rule.scope,
        "subject_hash": hash_subject(subject),
        "window_start": window_start,
        "request_count": 1,
        "expires_at": now + timedelta(seconds=rule.window_seconds * 2),
    }
    dialect = db.get_bind().dialect.name

    if dialect == "postgresql":
        statement = postgres_insert(RateLimitBucket).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=["scope", "subject_hash", "window_start"],
            set_={
                "request_count": RateLimitBucket.request_count + 1,
                "expires_at": values["expires_at"],
            },
        ).returning(RateLimitBucket.request_count)
        count = db.execute(statement).scalar_one()
    elif dialect == "sqlite":
        statement = sqlite_insert(RateLimitBucket).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=["scope", "subject_hash", "window_start"],
            set_={
                "request_count": RateLimitBucket.request_count + 1,
                "expires_at": values["expires_at"],
            },
        ).returning(RateLimitBucket.request_count)
        count = db.execute(statement).scalar_one()
    else:
        bucket = db.query(RateLimitBucket).filter_by(
            scope=rule.scope,
            subject_hash=values["subject_hash"],
            window_start=window_start,
        ).with_for_update().first()
        if bucket:
            bucket.request_count += 1
            bucket.expires_at = values["expires_at"]
        else:
            bucket = RateLimitBucket(**values)
            db.add(bucket)
        db.flush()
        count = bucket.request_count

    return int(count), retry_after


def _maybe_prune(db: Session, now: datetime) -> None:
    global _last_cleanup
    monotonic_now = time.monotonic()
    with _cleanup_lock:
        if monotonic_now - _last_cleanup < 300:
            return
        _last_cleanup = monotonic_now
    db.execute(delete(RateLimitBucket).where(RateLimitBucket.expires_at < now))


def _enforce_development_fallback(
    checks: tuple[tuple[RateLimitRule, str], ...],
    now: datetime,
) -> None:
    """Keep local development usable when a remote rate-limit table is down.

    Production deliberately remains fail-closed below. This fallback only
    prevents a transient Supabase outage from making local login, registration,
    and reset flows impossible to test.
    """
    results = []
    with _development_lock:
        current_epoch = int(now.replace(tzinfo=timezone.utc).timestamp())
        for rule, subject in checks:
            window_start = current_epoch - (current_epoch % rule.window_seconds)
            key = (rule.scope, hash_subject(subject), window_start)
            _development_buckets[key] = _development_buckets.get(key, 0) + 1
            retry_after = max(1, window_start + rule.window_seconds - current_epoch)
            results.append((rule, _development_buckets[key], retry_after))

        # Bound the development-only structure as time advances.
        expired_before = current_epoch - 7_200
        for key in list(_development_buckets):
            if key[2] < expired_before:
                _development_buckets.pop(key, None)

    for rule, count, retry_after in results:
        if count > rule.limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait before trying again.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Code": "rate_limited",
                },
            )


def enforce_rate_limits(
    db: Session,
    *checks: tuple[RateLimitRule, str],
    now: datetime | None = None,
) -> None:
    current_time = now or utcnow_naive()
    try:
        _maybe_prune(db, current_time)
        results = []
        for rule, subject in checks:
            count, retry_after = _increment_bucket(db, rule, subject, current_time)
            results.append((rule, count, retry_after))

        # A request can have more than one protection rule. Keep their updates
        # in one transaction so remote PostgreSQL latency is paid once instead
        # of once per rule (notably for login and token refresh).
        db.commit()
        for rule, count, retry_after in results:
            if count > rule.limit:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please wait before trying again.",
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Code": "rate_limited",
                    },
                )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        if APP_ENV != "production":
            logger.warning(
                "Shared rate-limit store is unavailable; using development fallback: %s",
                exc,
            )
            _enforce_development_fallback(checks, current_time)
            return
        logger.error("Shared rate-limit store is unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Request protection service is temporarily unavailable",
        ) from exc
