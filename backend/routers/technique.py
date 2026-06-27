from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import SessionLocal
from models.technique import Technique
from models.technique_step import TechniqueStep
from models.target_angle import TargetAngle

router = APIRouter(prefix="/techniques", tags=["Techniques"])


# -------------------------
# DB Dependency
# -------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -------------------------
# CREATE TECHNIQUE
# -------------------------
@router.post("/")
def create_technique(name: str, description: str, db: Session = Depends(get_db)):
    technique = Technique(name=name, description=description)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
def create_full_technique(data: dict, db: Session = Depends(get_db)):
    technique = Technique(
        name=data["name"],
        description=data.get("description", "")
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