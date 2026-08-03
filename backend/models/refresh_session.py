from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from database import Base


def utcnow_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    family_id = Column(String(64), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    replaced_by_hash = Column(String(64), nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=utcnow_naive)
    last_used_at = Column(DateTime, nullable=True)
    user_agent_hash = Column(String(64), nullable=True)

