"""Move static catalog navigation from PostgreSQL to backend JSON.

Revision ID: b45e92c1d713
Revises: a13d84f6b921
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b45e92c1d713"
down_revision: Union[str, Sequence[str], None] = "a13d84f6b921"
branch_labels = None
depends_on = None
JSON_CONFIG = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table_name in ("catalog_placements", "catalog_items", "catalog_nodes"):
        if table_name in existing_tables:
            op.drop_table(table_name)


def downgrade() -> None:
    # Recreate the retired schema empty. Static rows remain recoverable from
    # the checked-in JSON snapshot and are intentionally not copied back.
    op.create_table(
        "catalog_nodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=192), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("catalog_nodes.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("node_type", sa.String(length=32), nullable=False, server_default="category"),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("slug", name="uq_catalog_nodes_slug"),
    )
    op.create_index("ix_catalog_nodes_slug", "catalog_nodes", ["slug"])
    op.create_index("ix_catalog_nodes_parent_id", "catalog_nodes", ["parent_id"])
    op.create_index("ix_catalog_nodes_node_type", "catalog_nodes", ["node_type"])
    op.create_index("ix_catalog_nodes_active", "catalog_nodes", ["active"])
    op.create_table(
        "catalog_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("resource_type", sa.String(length=48), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("slug", name="uq_catalog_items_slug"),
        sa.UniqueConstraint("resource_type", "resource_id", name="uq_catalog_item_resource"),
    )
    op.create_index("ix_catalog_items_slug", "catalog_items", ["slug"])
    op.create_index("ix_catalog_items_resource_type", "catalog_items", ["resource_type"])
    op.create_index("ix_catalog_items_resource_id", "catalog_items", ["resource_id"])
    op.create_index("ix_catalog_items_active", "catalog_items", ["active"])
    op.create_table(
        "catalog_placements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("catalog_item_id", sa.Integer(), sa.ForeignKey("catalog_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("catalog_node_id", sa.Integer(), sa.ForeignKey("catalog_nodes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("catalog_item_id", "catalog_node_id", name="uq_catalog_placement"),
    )
    op.create_index("ix_catalog_placements_catalog_item_id", "catalog_placements", ["catalog_item_id"])
    op.create_index("ix_catalog_placements_catalog_node_id", "catalog_placements", ["catalog_node_id"])
