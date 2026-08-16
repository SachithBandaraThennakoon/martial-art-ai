from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.awareness import AwarenessKnowledgeProfileRecord

from .knowledge import KnowledgeProfile


VALID_STATUSES = {"draft", "in_review", "active", "retired"}


def _profile(record: AwarenessKnowledgeProfileRecord) -> KnowledgeProfile:
    return KnowledgeProfile.model_validate_json(record.payload_json)


def create_profile(db: Session, admin_user_id: int, profile: KnowledgeProfile):
    existing = db.query(AwarenessKnowledgeProfileRecord).filter(
        AwarenessKnowledgeProfileRecord.profile_id == profile.profile_id,
        AwarenessKnowledgeProfileRecord.version == profile.version,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="knowledge profile version already exists")
    record = AwarenessKnowledgeProfileRecord(
        profile_id=profile.profile_id,
        version=profile.version,
        status="draft",
        payload_json=profile.model_dump_json(),
        created_by_user_id=admin_user_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_profiles(db: Session):
    return db.query(AwarenessKnowledgeProfileRecord).order_by(
        AwarenessKnowledgeProfileRecord.created_at.desc()
    ).all()


def get_profile_record(db: Session, record_id: int):
    record = db.query(AwarenessKnowledgeProfileRecord).filter(
        AwarenessKnowledgeProfileRecord.id == record_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="knowledge profile not found")
    return record


def submit_profile(db: Session, record_id: int):
    record = get_profile_record(db, record_id)
    if record.status != "draft":
        raise HTTPException(status_code=409, detail="only draft profiles can be submitted")
    record.status = "in_review"
    db.commit()
    db.refresh(record)
    return record


def activate_profile(db: Session, record_id: int, reviewer_user_id: int):
    record = get_profile_record(db, record_id)
    if record.status != "in_review":
        raise HTTPException(status_code=409, detail="profile must be in review before activation")
    KnowledgeProfile.model_validate_json(record.payload_json)
    db.query(AwarenessKnowledgeProfileRecord).filter(
        AwarenessKnowledgeProfileRecord.status == "active"
    ).update({AwarenessKnowledgeProfileRecord.status: "retired"}, synchronize_session="fetch")
    record.status = "active"
    record.reviewed_by_user_id = reviewer_user_id
    record.activated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


def active_profile(db: Session) -> KnowledgeProfile | None:
    record = db.query(AwarenessKnowledgeProfileRecord).filter(
        AwarenessKnowledgeProfileRecord.status == "active"
    ).order_by(AwarenessKnowledgeProfileRecord.activated_at.desc()).first()
    return _profile(record) if record else None


def record_payload(record: AwarenessKnowledgeProfileRecord):
    return {
        "id": record.id,
        "profile_id": record.profile_id,
        "version": record.version,
        "status": record.status,
        "profile": _profile(record),
        "created_by_user_id": record.created_by_user_id,
        "reviewed_by_user_id": record.reviewed_by_user_id,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "activated_at": record.activated_at,
    }
