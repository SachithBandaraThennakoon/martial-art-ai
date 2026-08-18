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


class AwarenessObjectMemory(Base):
    __tablename__ = "awareness_object_memories"
    __table_args__ = (UniqueConstraint("user_id", "object_id", name="uq_awareness_object_memory"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    object_id = Column(String(96), nullable=False)
    object_type = Column(String(48), nullable=False, index=True)
    l4_json = Column(Text, nullable=False, default="{}")
    session_keys_json = Column(Text, nullable=False, default="[]")
    lifetime_observations = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AwarenessRelationshipMemory(Base):
    __tablename__ = "awareness_relationship_memories"
    __table_args__ = (UniqueConstraint("user_id", "relationship_id", name="uq_awareness_relationship_memory"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    relationship_id = Column(String(160), nullable=False)
    relationship_type = Column(String(64), nullable=False, index=True)
    l4_json = Column(Text, nullable=False, default="{}")
    session_keys_json = Column(Text, nullable=False, default="[]")
    lifetime_observations = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AwarenessActionDelivery(Base):
    __tablename__ = "awareness_action_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "awareness_session_id", "revision", "action_id",
            name="uq_awareness_action_delivery",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    awareness_session_id = Column(Integer, ForeignKey("awareness_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    revision = Column(Integer, nullable=False, index=True)
    action_id = Column(String(128), nullable=False)
    channel = Column(String(32), nullable=False, index=True)
    command = Column(String(64), nullable=False)
    status = Column(String(24), nullable=False, index=True)
    latency_ms = Column(Float, nullable=False, default=0)
    detail_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
