"""Remove superseded prototype taxonomy tables and technique columns.

Revision ID: fc06b8d0e145
Revises: fbf5a7c9d034
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "fc06b8d0e145"
down_revision: Union[str, Sequence[str], None] = "fbf5a7c9d034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Superseded by catalog_nodes/catalog_items and required_plan.
    with op.batch_alter_table("techniques") as batch_op:
        batch_op.drop_column("group_id")
        batch_op.drop_column("image_url")
        batch_op.drop_column("video_url")
        batch_op.drop_column("is_premium")
    op.drop_table("technique_groups")
    op.drop_table("martial_categories")


def downgrade() -> None:
    op.create_table(
        "martial_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.true()),
    )
    op.create_table(
        "technique_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True, server_default="0"),
    )
    with op.batch_alter_table("techniques") as batch_op:
        batch_op.add_column(sa.Column("group_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("image_url", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("video_url", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("is_premium", sa.Boolean(), nullable=True, server_default=sa.false()))
