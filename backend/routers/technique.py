from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth_context import require_admin_user
from database import get_db
from models.technique import Technique
from models.technique_step import TechniqueStep
from models.target_angle import TargetAngle
from models.user import User
from services.technique_package_loader import load_technique_packages

router = APIRouter(prefix="/techniques", tags=["Techniques"])


@router.get("/guide/{technique_id}")
def get_technique_guide(technique_id: str, db: Session = Depends(get_db)):
    """Return reviewed learning content and animation keyframes for one technique."""
    technique = db.query(Technique).filter(
        Technique.slug == technique_id,
        Technique.status == "active",
    ).first()
    if technique and technique.learning_content:
        content = technique.learning_content
        if content.get("status") != "PUBLISHED":
            raise HTTPException(404, "Technique Guide is not available")
        return {
            "id": technique.slug,
            "name": technique.name,
            "difficulty": technique.difficulty,
            "learning_content": content,
            "steps": (technique.training_config or {}).get("steps", []),
        }

    # File packages remain the transition fallback until an environment has
    # been migrated and synchronized for the first time.
    package = next(
        (
            item for item in load_technique_packages()
            if item["catalog"]["id"] == technique_id
        ),
        None,
    )
    content = package.get("learning_content") if package else None
    if not content or content.get("status") != "PUBLISHED":
        raise HTTPException(404, "Technique Guide is not available")
    return {
        "id": technique_id,
        "name": package["catalog"]["name"],
        "difficulty": package["catalog"].get("difficulty"),
        "learning_content": content,
        "steps": package["training_steps"].get("steps", []),
    }


def _technique_payload(technique: Technique) -> dict:
    return {
        "id": technique.id,
        "slug": technique.slug,
        "name": technique.name,
        "description": technique.description,
        "difficulty": technique.difficulty,
        "status": technique.status,
        "version": technique.version,
        "category": technique.category,
        "subcategory": technique.subcategory,
        "price": technique.price,
        "required_plan": technique.required_plan,
        "family_id": technique.family_id,
        "metadata": technique.metadata_json,
    }


@router.get("/{technique_slug}/training")
def get_technique_training(technique_slug: str, db: Session = Depends(get_db)):
    technique = db.query(Technique).filter(
        Technique.slug == technique_slug,
        Technique.status == "active",
    ).first()
    if not technique or technique.training_config is None:
        raise HTTPException(404, "Technique training configuration not found")
    return {"technique": _technique_payload(technique), "training_config": technique.training_config}


@router.get("/{technique_slug}/learning")
def get_technique_learning(technique_slug: str, db: Session = Depends(get_db)):
    technique = db.query(Technique).filter(
        Technique.slug == technique_slug,
        Technique.status == "active",
    ).first()
    if not technique or technique.learning_content is None:
        raise HTTPException(404, "Technique learning content not found")
    return {"technique": _technique_payload(technique), "learning_content": technique.learning_content}


@router.get("/{technique_slug}/tracking")
def get_technique_tracking(technique_slug: str, db: Session = Depends(get_db)):
    """Return the temporal tracking package stored inside the DB training JSONB."""
    technique = db.query(Technique).filter(
        Technique.slug == technique_slug,
        Technique.status == "active",
    ).first()
    tracking = (technique.training_config or {}).get("temporal_runtime") if technique else None
    if not technique or not tracking:
        raise HTTPException(404, "Technique tracking configuration not found")
    return {"technique": _technique_payload(technique), "tracking_config": tracking}


@router.get("/{technique_slug}")
def get_technique(technique_slug: str, db: Session = Depends(get_db)):
    technique = db.query(Technique).filter(
        Technique.slug == technique_slug,
        Technique.status == "active",
    ).first()
    if not technique:
        raise HTTPException(404, "Technique not found")
    return _technique_payload(technique)


# -------------------------
# CREATE TECHNIQUE
# -------------------------
@router.post("/")
def create_technique(
    name: str,
    description: str = "",
    category: str = "",
    subcategory: str = "",
    difficulty: str = "Beginner",
    price: float = 0,
    required_plan: str = "FREE_PLAN",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user)
):
    technique = Technique(
        name=name,
        description=description,
        category=category,
        subcategory=subcategory,
        difficulty=difficulty,
        price=price,
        required_plan=required_plan
    )
    db.add(technique)
    db.commit()
    db.refresh(technique)

    return technique


# -------------------------
# ADD STEP
# -------------------------
@router.post("/{technique_id}/steps")
def create_step(
    technique_id: int,
    step_number: int,
    step_name: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user)
):
    step = TechniqueStep(
        technique_id=technique_id,
        step_number=step_number,
        step_name=step_name
    )

    db.add(step)
    db.commit()
    db.refresh(step)

    return step


# -------------------------
# ADD TARGET ANGLE
# -------------------------
@router.post("/steps/{step_id}/angles")
def add_target_angle(
    step_id: int,
    body_part: str,
    min_angle: float,
    max_angle: float,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user)
):
    angle = TargetAngle(
        step_id=step_id,
        body_part=body_part,
        min_angle=min_angle,
        max_angle=max_angle
    )

    db.add(angle)
    db.commit()

    return {"message": "Angle added"}


# -------------------------
# GET TECHNIQUES
# -------------------------
@router.get("/")
def get_techniques(db: Session = Depends(get_db)):
    techniques = db.query(Technique).all()

    return [
        {
            "id": t.id,
            "name": t.name,
            "category": t.category,
            "subcategory": t.subcategory,
            "difficulty": t.difficulty,
            "price": t.price,
            "required_plan": t.required_plan,
            "description": t.description
        }
        for t in techniques
    ]


# -------------------------
# GET STEPS
# -------------------------
@router.get("/{technique_id}/steps")
def get_steps(technique_id: int, db: Session = Depends(get_db)):
    steps = db.query(TechniqueStep).filter(
        TechniqueStep.technique_id == technique_id
    ).order_by(TechniqueStep.step_number).all()

    return [
        {
            "id": s.id,
            "step_number": s.step_number,
            "step_name": s.step_name
        }
        for s in steps
    ]


# -------------------------
# FULL TECHNIQUE CREATION (BEST)
# -------------------------
@router.post("/full")
def create_full_technique(
    data: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user)
):
    technique = Technique(
        name=data["name"],
        description=data.get("description", ""),
        category=data.get("category", ""),
        subcategory=data.get("subcategory", ""),
        difficulty=data.get("difficulty", "Beginner"),
        price=data.get("price", 0),
        required_plan=data.get("required_plan", "FREE_PLAN")
    )

    db.add(technique)
    db.commit()
    db.refresh(technique)

    for step in data["steps"]:
        new_step = TechniqueStep(
            technique_id=technique.id,
            step_number=step["step_number"],
            step_name=step["step_name"]
        )
        db.add(new_step)
        db.commit()
        db.refresh(new_step)

        for angle in step.get("angles", []):
            db.add(TargetAngle(
                step_id=new_step.id,
                body_part=angle["body_part"],
                min_angle=angle["min"],
                max_angle=angle["max"]
            ))

    db.commit()

    return {
        "message": "Technique created successfully",
        "technique_id": technique.id
    }
