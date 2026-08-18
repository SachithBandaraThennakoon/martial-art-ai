"""Relational catalog navigation for DB-backed training resources."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from database import Base


JSON_CONFIG = JSONB().with_variant(JSON(), "sqlite")


class TechniqueFamily(Base):
    __tablename__ = "technique_families"
    __table_args__ = (UniqueConstraint("slug", name="uq_technique_families_slug"),)

    id = Column(Integer, primary_key=True)
    slug = Column(String(128), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    description = Column(String, nullable=True)
    parent_id = Column(Integer, ForeignKey("technique_families.id", ondelete="RESTRICT"), nullable=True, index=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CatalogNode(Base):
    __tablename__ = "catalog_nodes"
    __table_args__ = (UniqueConstraint("slug", name="uq_catalog_nodes_slug"),)

    id = Column(Integer, primary_key=True)
    slug = Column(String(192), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    parent_id = Column(Integer, ForeignKey("catalog_nodes.id", ondelete="RESTRICT"), nullable=True, index=True)
    node_type = Column(String(32), nullable=False, default="category", index=True)
    description = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True, index=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CatalogItem(Base):
    __tablename__ = "catalog_items"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_catalog_items_slug"),
        UniqueConstraint("resource_type", "resource_id", name="uq_catalog_item_resource"),
    )

    id = Column(Integer, primary_key=True)
    slug = Column(String(128), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    resource_type = Column(String(48), nullable=False, index=True)
    # Generic resource references deliberately have no FK: future resource
    # types may use different tables while sharing the same catalog.
    resource_id = Column(Integer, nullable=False, index=True)
    active = Column(Boolean, nullable=False, default=True, index=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CatalogPlacement(Base):
    __tablename__ = "catalog_placements"
    __table_args__ = (
        UniqueConstraint("catalog_item_id", "catalog_node_id", name="uq_catalog_placement"),
    )

    id = Column(Integer, primary_key=True)
    catalog_item_id = Column(Integer, ForeignKey("catalog_items.id", ondelete="CASCADE"), nullable=False, index=True)
    catalog_node_id = Column(Integer, ForeignKey("catalog_nodes.id", ondelete="RESTRICT"), nullable=False, index=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
