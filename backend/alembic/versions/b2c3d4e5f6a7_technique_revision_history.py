"""Add immutable technique publication history.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None
JSON_CONFIG = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "technique_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technique_id", sa.Integer(), sa.ForeignKey("techniques.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("training_config", JSON_CONFIG, nullable=True),
        sa.Column("learning_content", JSON_CONFIG, nullable=True),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_technique_revisions_technique_id", "technique_revisions", ["technique_id"])
    op.create_index("ix_technique_revisions_version", "technique_revisions", ["technique_id", "version"])


def downgrade() -> None:
    op.drop_table("technique_revisions")
