"""Prune short-lived personal data according to the documented retention schedule."""
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_

from database import SessionLocal, check_database_ready
from models.contact_message import ContactMessage
from models.password_reset_token import PasswordResetToken
from models.refresh_session import RefreshSession


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _days(name: str, default: int) -> int:
    return max(1, int(os.getenv(name, str(default))))


def main() -> int:
    if not check_database_ready():
        logger.error("Database is unavailable or not upgraded to the Alembic head")
        return 2
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    contact_cutoff = now - timedelta(days=_days("CONTACT_RETENTION_DAYS", 365))
    terminal_cutoff = now - timedelta(days=_days("AUTH_RECORD_RETENTION_DAYS", 30))
    with SessionLocal() as db:
        contacts = db.query(ContactMessage).filter(ContactMessage.created_at < contact_cutoff).delete(synchronize_session=False)
        resets = db.query(PasswordResetToken).filter(
            PasswordResetToken.created_at < terminal_cutoff,
            or_(PasswordResetToken.expires_at < now, PasswordResetToken.used_at.is_not(None)),
        ).delete(synchronize_session=False)
        sessions = db.query(RefreshSession).filter(
            RefreshSession.created_at < terminal_cutoff,
            or_(RefreshSession.expires_at < now, RefreshSession.revoked_at.is_not(None)),
        ).delete(synchronize_session=False)
        db.commit()
    logger.info("Pruned contacts=%s password_resets=%s refresh_sessions=%s", contacts, resets, sessions)
    return 0


if __name__ == "__main__":
    sys.exit(main())
