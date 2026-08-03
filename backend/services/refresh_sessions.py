from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.refresh_session import RefreshSession
from models.user import User


REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
if REFRESH_TOKEN_DAYS < 1 or REFRESH_TOKEN_DAYS > 90:
    raise RuntimeError("REFRESH_TOKEN_DAYS must be between 1 and 90")


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_agent_hash(user_agent: str | None) -> str | None:
    value = (user_agent or "").strip()
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value else None


def _new_token() -> str:
    return secrets.token_urlsafe(48)


def issue_refresh_session(
    db: Session,
    user: User,
    user_agent: str | None = None,
    family_id: str | None = None,
    now: datetime | None = None,
) -> tuple[str, RefreshSession]:
    issued_at = now or utcnow_naive()
    raw_token = _new_token()
    session = RefreshSession(
        user_id=user.id,
        family_id=family_id or secrets.token_hex(16),
        token_hash=hash_refresh_token(raw_token),
        expires_at=issued_at + timedelta(days=REFRESH_TOKEN_DAYS),
        user_agent_hash=_user_agent_hash(user_agent),
    )
    db.add(session)
    db.flush()
    return raw_token, session


def revoke_family(
    db: Session,
    family_id: str,
    now: datetime | None = None,
) -> None:
    revoked_at = now or utcnow_naive()
    db.query(RefreshSession).filter(
        RefreshSession.family_id == family_id,
        RefreshSession.revoked_at.is_(None),
    ).update({RefreshSession.revoked_at: revoked_at}, synchronize_session=False)


def revoke_user_sessions(
    db: Session,
    user_id: int,
    now: datetime | None = None,
) -> None:
    revoked_at = now or utcnow_naive()
    db.query(RefreshSession).filter(
        RefreshSession.user_id == user_id,
        RefreshSession.revoked_at.is_(None),
    ).update({RefreshSession.revoked_at: revoked_at}, synchronize_session=False)


def prune_expired_refresh_sessions(
    db: Session,
    now: datetime | None = None,
) -> None:
    # Keep expired rows briefly so late replay signals remain observable, then
    # remove them as routine session metadata rather than retaining indefinitely.
    cutoff = (now or utcnow_naive()) - timedelta(days=7)
    db.query(RefreshSession).filter(
        RefreshSession.expires_at < cutoff
    ).delete(synchronize_session=False)


def revoke_refresh_token(db: Session, raw_token: str | None) -> None:
    if not raw_token:
        return
    session = db.query(RefreshSession).filter(
        RefreshSession.token_hash == hash_refresh_token(raw_token)
    ).with_for_update().first()
    if session:
        revoke_family(db, session.family_id)


def rotate_refresh_session(
    db: Session,
    raw_token: str,
    user_agent: str | None = None,
    now: datetime | None = None,
) -> tuple[str, RefreshSession, User]:
    current_time = now or utcnow_naive()
    token_hash = hash_refresh_token(raw_token)
    session = db.query(RefreshSession).filter(
        RefreshSession.token_hash == token_hash
    ).with_for_update().first()

    if not session:
        raise HTTPException(status_code=401, detail="Refresh session is invalid")

    if session.revoked_at is not None:
        # A token that was already replaced is a replay signal. Revoke the whole
        # family, including the newest descendant, before rejecting it.
        if session.replaced_by_hash:
            revoke_family(db, session.family_id, current_time)
            db.commit()
        raise HTTPException(status_code=401, detail="Refresh session is invalid")

    if session.expires_at <= current_time:
        session.revoked_at = current_time
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh session has expired")

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        session.revoked_at = current_time
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh session is invalid")

    new_token, replacement = issue_refresh_session(
        db,
        user,
        user_agent=user_agent,
        family_id=session.family_id,
        now=current_time,
    )
    session.last_used_at = current_time
    session.revoked_at = current_time
    session.replaced_by_hash = replacement.token_hash
    db.commit()
    db.refresh(replacement)
    return new_token, replacement, user
