"""Persist latest awareness worlds and compact event history.

Revision ID: a9d1e7f3c502
Revises: 2d3c4b5a6f7e
Create Date: 2026-08-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9d1e7f3c502"
down_revision: Union[str, Sequence[str], None] = "2d3c4b5a6f7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "awareness_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_key", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("latest_sequence", sa.Integer(), nullable=False),
        sa.Column("latest_snapshot", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "session_key", name="uq_awareness_session_user_key"),
    )
    op.create_index("ix_awareness_sessions_id", "awareness_sessions", ["id"])
    op.create_index("ix_awareness_sessions_user_id", "awareness_sessions", ["user_id"])
    op.create_table(
        "awareness_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("awareness_session_id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.String(length=512), nullable=False),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["awareness_session_id"], ["awareness_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_awareness_events_id", "awareness_events", ["id"])
    op.create_index("ix_awareness_events_awareness_session_id", "awareness_events", ["awareness_session_id"])
    op.create_index("ix_awareness_events_event_id", "awareness_events", ["event_id"])
    op.create_index("ix_awareness_events_revision", "awareness_events", ["revision"])
    op.create_index("ix_awareness_events_event_type", "awareness_events", ["event_type"])


def downgrade() -> None:
    op.drop_table("awareness_events")
    op.drop_table("awareness_sessions")
