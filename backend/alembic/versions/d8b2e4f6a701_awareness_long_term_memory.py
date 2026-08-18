"""Add durable L4 object and relationship memory.

Revision ID: d8b2e4f6a701
Revises: c7a1d9e3f425
Create Date: 2026-08-17
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "d8b2e4f6a701"
down_revision: Union[str, Sequence[str], None] = "c7a1d9e3f425"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "awareness_object_memories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_id", sa.String(96), nullable=False),
        sa.Column("object_type", sa.String(48), nullable=False),
        sa.Column("l4_json", sa.Text(), nullable=False),
        sa.Column("session_keys_json", sa.Text(), nullable=False),
        sa.Column("lifetime_observations", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "object_id", name="uq_awareness_object_memory"),
    )
    op.create_index("ix_awareness_object_memories_id", "awareness_object_memories", ["id"])
    op.create_index("ix_awareness_object_memories_user_id", "awareness_object_memories", ["user_id"])
    op.create_index("ix_awareness_object_memories_object_type", "awareness_object_memories", ["object_type"])
    op.create_table(
        "awareness_relationship_memories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_id", sa.String(160), nullable=False),
        sa.Column("relationship_type", sa.String(64), nullable=False),
        sa.Column("l4_json", sa.Text(), nullable=False),
        sa.Column("session_keys_json", sa.Text(), nullable=False),
        sa.Column("lifetime_observations", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "relationship_id", name="uq_awareness_relationship_memory"),
    )
    op.create_index("ix_awareness_relationship_memories_id", "awareness_relationship_memories", ["id"])
    op.create_index("ix_awareness_relationship_memories_user_id", "awareness_relationship_memories", ["user_id"])
    op.create_index("ix_awareness_relationship_memories_relationship_type", "awareness_relationship_memories", ["relationship_type"])


def downgrade() -> None:
    op.drop_table("awareness_relationship_memories")
    op.drop_table("awareness_object_memories")
