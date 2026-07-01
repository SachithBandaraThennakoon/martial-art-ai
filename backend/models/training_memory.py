from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from database import Base


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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
