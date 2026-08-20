from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth_context import require_admin_user
from database import get_db
from models.technique import Technique
from models.user import User
from services.technique_package_loader import load_technique_packages
from services.system_snapshots import load_technique_snapshot

router = APIRouter(prefix="/techniques", tags=["Techniques"])


@router.get("/guide/{technique_id}")
def get_technique_guide(technique_id: str, db: Session = Depends(get_db)):
    """Return reviewed learning content and animation keyframes for one technique."""
    snapshot = load_technique_snapshot(technique_id)
    if snapshot:
        content = snapshot.get("learning_content")
        if not content or content.get("status") != "PUBLISHED":
            raise HTTPException(404, "Technique Guide is not available")
        technique = snapshot["technique"]
        return {
            "id": technique["slug"],
            "name": technique["name"],
            "difficulty": technique["difficulty"],
            "learning_content": content,
            "steps": (snapshot.get("training_config") or {}).get("steps", []),
        }

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
        "metadata": technique.metadata_json,
    }


@router.get("/{technique_slug}/training")
def get_technique_training(technique_slug: str, db: Session = Depends(get_db)):
    snapshot = load_technique_snapshot(technique_slug)
    if snapshot:
        training_config = snapshot.get("training_config") or {}
        if not isinstance(training_config.get("steps"), list) or not training_config.get("steps"):
            raise HTTPException(409, "This activity is catalog-only until training steps are authored")
        return {"technique": snapshot["technique"], "training_config": training_config}

    technique = db.query(Technique).filter(
        Technique.slug == technique_slug,
        Technique.status == "active",
    ).first()
    if not technique or technique.training_config is None:
        raise HTTPException(404, "Technique training configuration not found")
    if not isinstance(technique.training_config.get("steps"), list) or not technique.training_config.get("steps"):
        raise HTTPException(409, "This activity is catalog-only until training steps are authored")
    return {"technique": _technique_payload(technique), "training_config": technique.training_config}


@router.get("/{technique_slug}/learning")
def get_technique_learning(technique_slug: str, db: Session = Depends(get_db)):
    snapshot = load_technique_snapshot(technique_slug)
    if snapshot:
        content = snapshot.get("learning_content")
        if content is None:
            raise HTTPException(404, "Technique learning content not found")
        return {"technique": snapshot["technique"], "learning_content": content}

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
    snapshot = load_technique_snapshot(technique_slug)
    if snapshot:
        tracking = (snapshot.get("training_config") or {}).get("temporal_runtime")
        if not tracking:
            raise HTTPException(404, "Technique tracking configuration not found")
        return {"technique": snapshot["technique"], "tracking_config": tracking}

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
    snapshot = load_technique_snapshot(technique_slug)
    if snapshot:
        return snapshot["technique"]

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


