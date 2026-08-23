"""Remove the redundant durable awareness event archive.

Live transition events remain bounded in the process-local awareness store.
Sessions, evaluations, action deliveries, knowledge, and long-term memory stay
durable in PostgreSQL.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "b45e92c1d713"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("awareness_events")


def downgrade() -> None:
    op.create_table(
        "awareness_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("awareness_session_id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.String(length=512), nullable=False),
        sa.Column("data_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["awareness_session_id"], ["awareness_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_awareness_events_id", "awareness_events", ["id"])
    op.create_index("ix_awareness_events_awareness_session_id", "awareness_events", ["awareness_session_id"])
    op.create_index("ix_awareness_events_event_id", "awareness_events", ["event_id"], unique=True)
    op.create_index("ix_awareness_events_revision", "awareness_events", ["revision"])
    op.create_index("ix_awareness_events_event_type", "awareness_events", ["event_type"])
