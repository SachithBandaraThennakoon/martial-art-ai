"""Remove unused technique family and variant tables.

Revision ID: a13d84f6b921
Revises: fd17c9e2a463
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a13d84f6b921"
down_revision: Union[str, Sequence[str], None] = "fd17c9e2a463"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("technique_variants")
    op.drop_table("technique_families")
    op.drop_index("ix_techniques_family_id", table_name="techniques")
    op.drop_column("techniques", "family_id")


def downgrade() -> None:
    op.add_column("techniques", sa.Column("family_id", sa.Integer(), nullable=True))
    op.create_index("ix_techniques_family_id", "techniques", ["family_id"])
    op.create_table(
        "technique_families",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("technique_families.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_technique_families_slug"),
    )
    op.create_index("ix_technique_families_slug", "technique_families", ["slug"])
    op.create_index("ix_technique_families_parent_id", "technique_families", ["parent_id"])
    op.create_table(
        "technique_variants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technique_id", sa.Integer(), sa.ForeignKey("techniques.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("variant_type", sa.String(48), nullable=False, server_default="variation"),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("review_status", sa.String(32), nullable=False, server_default="unreviewed"),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("technique_id", "slug", name="uq_technique_variants_technique_slug"),
    )
    op.create_index("ix_technique_variants_technique_id", "technique_variants", ["technique_id"])
    op.create_index("ix_technique_variants_status", "technique_variants", ["status"])
    op.create_index("ix_technique_variants_review_status", "technique_variants", ["review_status"])
