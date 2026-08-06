from sqlalchemy import func, text

from models.target_angle import TargetAngle
from models.target_position import TargetPosition
from models.technique import Technique
from models.technique_step import TechniqueStep
from services.technique_package_loader import TECHNIQUE_ROOT, load_technique_catalog


def sync_technique_catalog(db, technique_root=TECHNIQUE_ROOT):
    """Idempotently upsert package taxonomy, steps and targets, then link legacy sessions."""
    payload = load_technique_catalog(technique_root)
    created = 0
    updated = 0

    for source in payload.get("techniques", []):
        technique = db.query(Technique).filter(
            func.lower(Technique.name) == source["name"].strip().lower()
        ).first()
        if not technique:
            technique = Technique(name=source["name"].strip())
            db.add(technique)
            db.flush()
            created += 1
        else:
            updated += 1

        technique.category = source.get("category") or "Technique Training"
        technique.subcategory = source.get("subcategory") or "General"
        technique.difficulty = source.get("difficulty") or "Beginner"
        technique.description = source.get("description") or ""
        technique.price = source.get("price", 0)
        technique.required_plan = source.get("required_plan", "FREE_PLAN")

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
    for table in ("practice_sessions", "training_sessions"):
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
