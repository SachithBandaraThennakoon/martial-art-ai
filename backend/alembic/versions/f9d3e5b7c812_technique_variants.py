"""Add first-class technique variants.

Revision ID: f9d3e5b7c812
Revises: b2c3d4e5f6a7
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f9d3e5b7c812"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None
JSON_CONFIG = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "technique_variants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technique_id", sa.Integer(), sa.ForeignKey("techniques.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("variant_type", sa.String(length=48), nullable=False, server_default="variation"),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("review_status", sa.String(length=32), nullable=False, server_default="unreviewed"),
        sa.Column("capabilities", JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("config", JSON_CONFIG, nullable=True),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("technique_id", "slug", name="uq_technique_variants_technique_slug"),
    )
    op.create_index("ix_technique_variants_technique_id", "technique_variants", ["technique_id"])
    op.create_index("ix_technique_variants_status", "technique_variants", ["status"])
    op.create_index("ix_technique_variants_review_status", "technique_variants", ["review_status"])


def downgrade() -> None:
    op.drop_table("technique_variants")
