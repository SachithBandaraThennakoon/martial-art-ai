from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.sql import func

from database import Base


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    technique_id = Column(Integer, ForeignKey("techniques.id"), nullable=True, index=True)
    technique_name = Column(String, index=True)
    mode = Column(String, default="train")
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    final_accuracy = Column(Float, default=0)
    completed = Column(Boolean, default=False)


class TrainingStepAttempt(Base):
    __tablename__ = "training_step_attempts"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("training_sessions.id"), index=True)
    step_key = Column(String, index=True)
    step_name = Column(String)
    best_accuracy = Column(Float, default=0)
    average_accuracy = Column(Float, default=0)
    attempts_count = Column(Integer, default=0)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class TrainingFeedbackEvent(Base):
    __tablename__ = "training_feedback_events"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("training_sessions.id"), index=True)
    step_key = Column(String, index=True)
    body_part = Column(String, nullable=True)
    issue = Column(String, nullable=True)
    feedback_text = Column(Text)
    accuracy = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserTrainingMemory(Base):
    __tablename__ = "user_training_memory"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    memory_key = Column(String, index=True)
    memory_value = Column(Text)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    technique_id = Column(Integer, ForeignKey("techniques.id"), nullable=True, index=True)
    technique_name = Column(String, index=True)
    step_key = Column(String, nullable=True, index=True)
    step_name = Column(String, nullable=True)
    target_reps = Column(Integer, default=5)
    completed_reps = Column(Integer, default=0)
    clean_reps = Column(Integer, default=0)
    average_accuracy = Column(Float, default=0)
    best_accuracy = Column(Float, default=0)
    average_rep_seconds = Column(Float, default=0)
    consistency_score = Column(Float, default=0)
    status = Column(String, default="active", index=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)


class PracticeRep(Base):
    __tablename__ = "practice_reps"

    id = Column(Integer, primary_key=True, index=True)
    practice_session_id = Column(Integer, ForeignKey("practice_sessions.id"), index=True)
    rep_number = Column(Integer)
    accuracy = Column(Float, default=0)
    duration_ms = Column(Integer, default=0)
    speed_label = Column(String, nullable=True)
    quality_label = Column(String, nullable=True)
    focus_body_part = Column(String, nullable=True)
    issue = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), server_default=func.now())


class PracticeSessionTape(Base):
    __tablename__ = "practice_session_tapes"

    id = Column(Integer, primary_key=True, index=True)
    practice_session_id = Column(
        Integer,
        ForeignKey("practice_sessions.id"),
        nullable=False,
        unique=True,
        index=True
    )
    version = Column(Integer, default=1)
    frame_rate = Column(Integer, default=30)
    frame_count = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)
    codec = Column(String, default="zlib-json")
    payload = Column(LargeBinary, nullable=False)
    uncompressed_bytes = Column(Integer, default=0)
    compressed_bytes = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )


class PracticeSessionAnalytics(Base):
    __tablename__ = "practice_session_analytics"

    id = Column(Integer, primary_key=True, index=True)
    practice_session_id = Column(
        Integer,
        ForeignKey("practice_sessions.id"),
        nullable=False,
        unique=True,
        index=True
    )
    schema_version = Column(Integer, default=1)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
