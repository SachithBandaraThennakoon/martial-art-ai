import re

from sqlalchemy import func, inspect, text

from models.catalog import CatalogItem, CatalogNode, CatalogPlacement
from models.target_angle import TargetAngle
from models.target_position import TargetPosition
from models.technique import Technique
from models.technique_step import TechniqueStep
from services.technique_package_loader import TECHNIQUE_ROOT, load_technique_catalog, load_technique_packages


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    if not slug:
        raise ValueError("Catalog names require at least one letter or number")
    return slug


def _node_slug(parent: CatalogNode | None, name: str) -> str:
    own_slug = _slugify(name)
    return own_slug if parent is None else f"{parent.slug}--{own_slug}"


def _upsert_catalog_node(db, name: str, parent: CatalogNode | None, node_type: str, sort_order: int) -> CatalogNode:
    slug = _node_slug(parent, name)
    node = db.query(CatalogNode).filter(CatalogNode.slug == slug).first()
    if not node:
        node = CatalogNode(
            slug=slug,
            name=name.strip(),
            parent_id=parent.id if parent else None,
            node_type=node_type,
            sort_order=sort_order,
            active=True,
        )
        db.add(node)
        db.flush()
    node.name = name.strip()
    node.parent_id = parent.id if parent else None
    node.node_type = node_type
    node.sort_order = sort_order
    node.active = True
    return node


def _sync_catalog_placement(db, technique: Technique, source: dict, sort_order: int) -> None:
    """Create one canonical navigation placement without copying a technique."""
    root = _upsert_catalog_node(db, "Martial Arts", None, "root", 0)
    category_name = str(source.get("category") or "Technique Training")
    category = _upsert_catalog_node(db, category_name, root, "category", sort_order)
    subcategory_name = str(source.get("subcategory") or "General")
    placement_node = _upsert_catalog_node(db, subcategory_name, category, "category", sort_order)

    item = db.query(CatalogItem).filter(
        CatalogItem.resource_type == "technique",
        CatalogItem.resource_id == technique.id,
    ).first()
    if not item:
        item = CatalogItem(
            resource_type="technique",
            resource_id=technique.id,
            slug=technique.slug,
            title=technique.name,
            active=technique.status == "active",
        )
        db.add(item)
        db.flush()
    item.slug = technique.slug
    item.title = technique.name
    item.active = technique.status == "active"
    item.metadata_json = {
        "package_version": technique.version,
        "tracking_package": (technique.metadata_json or {}).get("tracking_package"),
        "tracking_version": (technique.metadata_json or {}).get("tracking_version"),
        "difficulty": technique.difficulty,
        "price": technique.price,
        "required_plan": technique.required_plan,
        "description": technique.description,
    }

    placement = db.query(CatalogPlacement).filter(
        CatalogPlacement.catalog_item_id == item.id,
        CatalogPlacement.catalog_node_id == placement_node.id,
    ).first()
    if not placement:
        placement = CatalogPlacement(catalog_item_id=item.id, catalog_node_id=placement_node.id)
        db.add(placement)
    placement.is_primary = True
    placement.sort_order = sort_order


def sync_technique_catalog(db, technique_root=TECHNIQUE_ROOT):
    """Idempotently upsert package taxonomy, steps and targets, then link legacy sessions."""
    payload = load_technique_catalog(technique_root)
    created = 0
    updated = 0

    packages = {item["catalog"]["id"]: item for item in load_technique_packages(technique_root)}
    for sort_order, source in enumerate(payload.get("techniques", [])):
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
        technique.version = str(package["index"].get("catalog_version") or source.get("schema_version") or "1.0.0")
        technique.training_config = package["training_steps"]
        technique.learning_content = package.get("learning_content")
        technique.metadata_json = {
            "catalog_schema_version": source.get("schema_version"),
            "tracking_package": source.get("tracking_package"),
            "tracking_version": source.get("tracking_version"),
            "package_index": package["index"],
            "has_tracking": package["has_tracking"],
        }

        _sync_catalog_placement(db, technique, source, sort_order)

        for step_source in source.get("steps", [])[:3]:
            step_number = int(step_source.get("step_number") or 1)
            step = db.query(TechniqueStep).filter(
                TechniqueStep.technique_id == technique.id,
                TechniqueStep.step_number == step_number,
            ).first()
            if not step:
                step = TechniqueStep(technique_id=technique.id, step_number=step_number)
                db.add(step)
                db.flush()
            step.step_name = step_source.get("step_name") or f"Step {step_number}"

            for angle_source in step_source.get("angles", []):
                body_part = str(angle_source.get("body_part") or "").strip()
                if not body_part:
                    continue
                angle = db.query(TargetAngle).filter(
                    TargetAngle.step_id == step.id,
                    TargetAngle.body_part == body_part,
                ).first()
                if not angle:
                    angle = TargetAngle(step_id=step.id, body_part=body_part)
                    db.add(angle)
                angle.min_angle = float(angle_source.get("min", angle_source.get("min_angle", 0)))
                angle.max_angle = float(angle_source.get("max", angle_source.get("max_angle", 180)))

            reference_pose = step_source.get("reference_pose") or {}
            coordinate_space = reference_pose.get("coordinate_space", "body_normalized_v1")
            tolerance = float(reference_pose.get("tolerance", 0.12))
            position_parts = set()
            for body_part, coordinates in (reference_pose.get("landmarks") or {}).items():
                if not isinstance(coordinates, list) or len(coordinates) != 3:
                    continue
                position_parts.add(body_part)
                position = db.query(TargetPosition).filter(
                    TargetPosition.step_id == step.id,
                    TargetPosition.body_part == body_part,
                ).first()
                if not position:
                    position = TargetPosition(step_id=step.id, body_part=body_part)
                    db.add(position)
                position.x, position.y, position.z = (float(value) for value in coordinates)
                position.tolerance = tolerance
                position.coordinate_space = coordinate_space
            if position_parts:
                db.query(TargetPosition).filter(
                    TargetPosition.step_id == step.id,
                    ~TargetPosition.body_part.in_(position_parts),
                ).delete(synchronize_session=False)

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
    return {"created": created, "updated": updated, "total": len(payload.get("techniques", []))}
