"""Add relational catalog navigation and JSONB technique packages.

Revision ID: a1b2c3d4e5f6
Revises: e9c3a5b7d812
Create Date: 2026-08-18
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "e9c3a5b7d812"
branch_labels = None
depends_on = None

JSON_CONFIG = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _slugify(value: str, record_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug or f"technique-{record_id}"


def _backfill_technique_slugs() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, name FROM techniques ORDER BY id")).mappings()
    used = set()
    for row in rows:
        base = _slugify(row["name"], row["id"])
        slug = base
        suffix = 2
        while slug in used:
            slug = f"{base}-{suffix}"
            suffix += 1
        used.add(slug)
        bind.execute(
            sa.text("UPDATE techniques SET slug = :slug WHERE id = :id"),
            {"slug": slug, "id": row["id"]},
        )


def upgrade() -> None:
    # Reuse the existing techniques table because training history already
    # references it. New columns are additive and legacy fields remain intact.
    op.add_column("techniques", sa.Column("slug", sa.String(length=128), nullable=False, server_default=""))
    op.add_column("techniques", sa.Column("family_id", sa.Integer(), nullable=True))
    op.add_column("techniques", sa.Column("status", sa.String(length=32), nullable=False, server_default="active"))
    op.add_column("techniques", sa.Column("version", sa.String(length=32), nullable=False, server_default="1.0.0"))
    op.add_column("techniques", sa.Column("training_config", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("learning_content", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("biomechanics_config", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("optimization_config", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("visualization_config", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("metadata_json", JSON_CONFIG, nullable=True))
    op.add_column("techniques", sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))
    op.add_column("techniques", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))

    _backfill_technique_slugs()

    op.create_index("ix_techniques_slug", "techniques", ["slug"], unique=True)
    op.create_index("ix_techniques_family_id", "techniques", ["family_id"], unique=False)
    op.create_index("ix_techniques_status", "techniques", ["status"], unique=False)

    op.create_table(
        "technique_families",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("technique_families.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("metadata_json", JSON_CONFIG, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("slug", name="uq_technique_families_slug"),
    )
    op.create_index("ix_technique_families_slug", "technique_families", ["slug"])
    op.create_index("ix_technique_families_parent_id", "technique_families", ["parent_id"])

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


def downgrade() -> None:
    op.drop_table("catalog_placements")
    op.drop_table("catalog_items")
    op.drop_table("catalog_nodes")
    op.drop_table("technique_families")
    op.drop_index("ix_techniques_status", table_name="techniques")
    op.drop_index("ix_techniques_family_id", table_name="techniques")
    op.drop_index("ix_techniques_slug", table_name="techniques")
    with op.batch_alter_table("techniques") as batch_op:
        batch_op.drop_column("updated_at")
        batch_op.drop_column("created_at")
        batch_op.drop_column("metadata_json")
        batch_op.drop_column("visualization_config")
        batch_op.drop_column("optimization_config")
        batch_op.drop_column("biomechanics_config")
        batch_op.drop_column("learning_content")
        batch_op.drop_column("training_config")
        batch_op.drop_column("version")
        batch_op.drop_column("status")
        batch_op.drop_column("family_id")
        batch_op.drop_column("slug")
