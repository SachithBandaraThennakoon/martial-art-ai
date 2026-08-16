from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from database import Base


class AwarenessSession(Base):
    __tablename__ = "awareness_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "session_key", name="uq_awareness_session_user_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_key = Column(String(128), nullable=False)
    schema_version = Column(String(32), nullable=False, default="awareness/v1")
    revision = Column(Integer, nullable=False, default=0)
    latest_sequence = Column(Integer, nullable=False, default=0)
    latest_snapshot = Column(Text, nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AwarenessEventRecord(Base):
    __tablename__ = "awareness_events"

    id = Column(Integer, primary_key=True, index=True)
    awareness_session_id = Column(
        Integer,
        ForeignKey("awareness_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_id = Column(String(32), nullable=False, unique=True, index=True)
    revision = Column(Integer, nullable=False, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    summary = Column(String(512), nullable=False)
    data_json = Column(Text, nullable=False, default="{}")
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AwarenessKnowledgeProfileRecord(Base):
    __tablename__ = "awareness_knowledge_profiles"
    __table_args__ = (
        UniqueConstraint("profile_id", "version", name="uq_awareness_knowledge_profile_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(String(96), nullable=False, index=True)
    version = Column(String(32), nullable=False)
    status = Column(String(24), nullable=False, default="draft", index=True)
    payload_json = Column(Text, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=True)


class AwarenessDecisionEvaluation(Base):
    __tablename__ = "awareness_decision_evaluations"
    __table_args__ = (
        UniqueConstraint("awareness_session_id", "revision", name="uq_awareness_evaluation_session_revision"),
    )

    id = Column(Integer, primary_key=True, index=True)
    awareness_session_id = Column(Integer, ForeignKey("awareness_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    revision = Column(Integer, nullable=False)
    client_state = Column(String(64), nullable=True)
    backend_state = Column(String(64), nullable=True)
    client_command = Column(String(96), nullable=True)
    backend_command = Column(String(96), nullable=True)
    state_agreement = Column(Boolean, nullable=True)
    command_agreement = Column(Boolean, nullable=True)
    backend_confidence = Column(Float, nullable=True)
    knowledge_profile_id = Column(String(96), nullable=False)
    knowledge_version = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
