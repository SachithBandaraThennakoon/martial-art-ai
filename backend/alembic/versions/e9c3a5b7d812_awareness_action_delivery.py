"""Add awareness action delivery acknowledgements.

Revision ID: e9c3a5b7d812
Revises: d8b2e4f6a701
Create Date: 2026-08-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e9c3a5b7d812"
down_revision: Union[str, Sequence[str], None] = "d8b2e4f6a701"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "awareness_action_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("awareness_session_id", sa.Integer(), sa.ForeignKey("awareness_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("action_id", sa.String(128), nullable=False),
        sa.Column("channel", sa.String(32), nullable=False),
        sa.Column("command", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False, server_default="0"),
        sa.Column("detail_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("awareness_session_id", "revision", "action_id", name="uq_awareness_action_delivery"),
    )
    op.create_index("ix_awareness_action_deliveries_id", "awareness_action_deliveries", ["id"])
    op.create_index("ix_awareness_action_deliveries_awareness_session_id", "awareness_action_deliveries", ["awareness_session_id"])
    op.create_index("ix_awareness_action_deliveries_revision", "awareness_action_deliveries", ["revision"])
    op.create_index("ix_awareness_action_deliveries_channel", "awareness_action_deliveries", ["channel"])
    op.create_index("ix_awareness_action_deliveries_status", "awareness_action_deliveries", ["status"])


def downgrade() -> None:
    op.drop_table("awareness_action_deliveries")
