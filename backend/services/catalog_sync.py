"""Synchronize authored backend technique packages into canonical techniques.

Catalog navigation is intentionally not synchronized to PostgreSQL.  It is the
checked-in JSON snapshot at data/system-catalog/catalog-index.json.
"""

from sqlalchemy import func, inspect, text

from models.technique import Technique
from services.cache import invalidate_catalog_cache
from services.technique_package_loader import (
    TECHNIQUE_ROOT,
    load_technique_catalog,
    load_technique_packages,
)


def sync_technique_catalog(db, technique_root=TECHNIQUE_ROOT):
    """Idempotently upsert package runtime configuration into techniques only."""
    payload = load_technique_catalog(technique_root)
    created = 0
    updated = 0

    packages = {item["catalog"]["id"]: item for item in load_technique_packages(technique_root)}
    for source in payload.get("techniques", []):
        package = packages[source["id"]]
        technique = db.query(Technique).filter(Technique.slug == source["id"]).first()
        if not technique:
            technique = db.query(Technique).filter(
                func.lower(Technique.name) == source["name"].strip().lower()
            ).first()
        if not technique:
            technique = Technique(slug=source["id"], name=source["name"].strip())
            db.add(technique)
            db.flush()
            created += 1
        else:
            updated += 1

        technique.slug = source["id"]
        technique.name = source["name"].strip()
        technique.category = source.get("category") or "Technique Training"
        technique.subcategory = source.get("subcategory") or "General"
        technique.difficulty = source.get("difficulty") or "Beginner"
        technique.description = source.get("description") or ""
        technique.price = source.get("price", 0)
        technique.required_plan = source.get("required_plan", "FREE_PLAN")
        technique.status = "active"
        technique.version = str(
            package["index"].get("catalog_version")
            or source.get("schema_version")
            or "1.0.0"
        )
        technique.training_config = package["training_steps"]
        technique.learning_content = package.get("learning_content")
        technique.metadata_json = {
            "catalog_schema_version": source.get("schema_version"),
            "tracking_package": source.get("tracking_package"),
            "tracking_version": source.get("tracking_version"),
            "package_index": package["index"],
            "has_tracking": package["has_tracking"],
        }

    db.commit()
    inspector = inspect(db.get_bind())
    for table in ("practice_sessions", "training_sessions"):
        if not inspector.has_table(table):
            continue
        db.execute(text(f"""
            UPDATE {table}
            SET technique_id = (
                SELECT techniques.id FROM techniques
                WHERE lower(techniques.name) = lower({table}.technique_name)
                LIMIT 1
            )
            WHERE technique_id IS NULL
        """))
    db.commit()
    invalidate_catalog_cache()
    return {"created": created, "updated": updated, "total": len(payload.get("techniques", []))}
