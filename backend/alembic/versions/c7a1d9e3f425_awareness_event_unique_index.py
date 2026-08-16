"""Align the awareness event index with model uniqueness metadata.

Revision ID: c7a1d9e3f425
Revises: b4e2f8a6d713
Create Date: 2026-08-16
"""
from typing import Sequence, Union

from alembic import op


revision: str = "c7a1d9e3f425"
down_revision: Union[str, Sequence[str], None] = "b4e2f8a6d713"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_awareness_events_event_id", table_name="awareness_events")
    op.create_index(
        "ix_awareness_events_event_id", "awareness_events", ["event_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_awareness_events_event_id", table_name="awareness_events")
    op.create_index(
        "ix_awareness_events_event_id", "awareness_events", ["event_id"], unique=False
    )
