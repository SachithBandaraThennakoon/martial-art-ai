import re

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from database import Base


JSON_CONFIG = JSONB().with_variant(JSON(), "sqlite")


def _default_technique_slug(context):
    """Keep legacy Technique(name=...) inserts compatible with the DB catalog."""
    name = context.get_current_parameters().get("name") or "technique"
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "technique"


class Technique(Base):
    __tablename__ = "techniques"

    id = Column(Integer, primary_key=True)
    # The legacy display fields below remain during the catalog transition.
    # `slug` and the JSON configuration columns are the stable DB-backed API.
    slug = Column(
        String(128), nullable=False, unique=True, index=True, default=_default_technique_slug
    )
    name = Column(String)
    category = Column(String)
    subcategory = Column(String)
    difficulty = Column(String)
    price = Column(Float, default=0)
    required_plan = Column(String, default="FREE_PLAN")
    description = Column(String)
    family_id = Column(Integer, nullable=True, index=True)
    status = Column(String(32), nullable=False, default="active", index=True)
    version = Column(String(32), nullable=False, default="1.0.0")
    training_config = Column(JSON_CONFIG, nullable=True)
    learning_content = Column(JSON_CONFIG, nullable=True)
    biomechanics_config = Column(JSON_CONFIG, nullable=True)
    optimization_config = Column(JSON_CONFIG, nullable=True)
    visualization_config = Column(JSON_CONFIG, nullable=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TechniqueRevision(Base):
    __tablename__ = "technique_revisions"
    __table_args__ = (
        Index("ix_technique_revisions_version", "technique_id", "version"),
    )

    id = Column(Integer, primary_key=True)
    technique_id = Column(
        Integer, ForeignKey("techniques.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version = Column(String(32), nullable=False)
    training_config = Column(JSON_CONFIG, nullable=True)
    learning_content = Column(JSON_CONFIG, nullable=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    # Kept as an audit identifier without an ORM FK so isolated catalog tests
    # can create metadata without importing the full user model graph.
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TechniqueVariant(Base):
    """A named variation of a canonical technique (for example, step jab)."""

    __tablename__ = "technique_variants"
    __table_args__ = (
        Index("ix_technique_variants_technique_slug", "technique_id", "slug", unique=True),
    )

    id = Column(Integer, primary_key=True)
    technique_id = Column(Integer, ForeignKey("techniques.id", ondelete="CASCADE"), nullable=False, index=True)
    slug = Column(String(128), nullable=False)
    name = Column(String(160), nullable=False)
    variant_type = Column(String(48), nullable=False, default="variation")
    description = Column(String, nullable=True)
    status = Column(String(32), nullable=False, default="draft", index=True)
    review_status = Column(String(32), nullable=False, default="unreviewed", index=True)
    capabilities = Column(JSON_CONFIG, nullable=False, default=dict)
    config = Column(JSON_CONFIG, nullable=True)
    metadata_json = Column(JSON_CONFIG, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
