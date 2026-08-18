"""Admin-only editing of runtime technique JSONB configuration."""

from datetime import datetime, timezone
from copy import deepcopy

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_context import require_admin_user
from database import get_db
from models.technique import Technique, TechniqueRevision
from models.user import User
from routers.catalog_admin import PackagePayload, _validate_payload


router = APIRouter(prefix="/admin/techniques", tags=["Admin techniques"])


class RuntimePublication(BaseModel):
    training_config: dict
    learning_content: dict | None = None
    catalog: dict | None = None


def _next_version(version: str | None) -> str:
    parts = str(version or "1.0.0").split(".")
    try:
        major, minor, patch = (int(parts[index]) if index < len(parts) else 0 for index in range(3))
    except ValueError:
        return "1.0.1"
    return f"{major}.{minor}.{patch + 1}"


def _catalog_payload(technique: Technique) -> dict:
    metadata = technique.metadata_json or {}
    return {
        "schema_version": metadata.get("catalog_schema_version") or "1.0",
        "id": technique.slug,
        "name": technique.name,
        "tracking_package": metadata.get("tracking_package") or technique.slug,
        "tracking_version": metadata.get("tracking_version") or "1.0.0",
        "category": technique.category,
        "subcategory": technique.subcategory,
        "difficulty": technique.difficulty,
        "price": technique.price,
        "required_plan": technique.required_plan,
        "description": technique.description,
    }


def _get_technique(db: Session, slug: str) -> Technique:
    technique = db.query(Technique).filter(Technique.slug == slug).first()
    if not technique:
        raise HTTPException(404, "Technique not found")
    return technique


@router.get("/{technique_slug}/runtime")
def get_runtime_editor_data(
    technique_slug: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    return {
        "id": technique.slug,
        "catalog": _catalog_payload(technique),
        "training_steps": technique.training_config,
        "learning_content": technique.learning_content,
        "version": technique.version,
        "enabled": technique.status == "active",
    }


def _record_update(technique: Technique, admin: User, field: str) -> None:
    technique.version = _next_version(technique.version)
    technique.metadata_json = {
        **(technique.metadata_json or {}),
        "runtime_source": "postgresql",
        "last_admin_update": {
            "field": field,
            "user_id": admin.id,
            "at": datetime.now(timezone.utc).isoformat(),
        },
    }


def _create_revision(db: Session, technique: Technique, admin: User, action: str) -> TechniqueRevision:
    revision = TechniqueRevision(
        technique_id=technique.id,
        version=technique.version,
        training_config=deepcopy(technique.training_config),
        learning_content=deepcopy(technique.learning_content),
        created_by=admin.id,
        metadata_json={"action": action},
    )
    db.add(revision)
    return revision


@router.get("/{technique_slug}/revisions")
def list_revisions(
    technique_slug: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    revisions = db.query(TechniqueRevision).filter(
        TechniqueRevision.technique_id == technique.id
    ).order_by(TechniqueRevision.id.desc()).all()
    return {
        "slug": technique.slug,
        "current_version": technique.version,
        "revisions": [
            {
                "id": item.id,
                "version": item.version,
                "created_at": item.created_at,
                "created_by": item.created_by,
                "action": (item.metadata_json or {}).get("action", "publish"),
            }
            for item in revisions
        ],
    }


@router.put("/{technique_slug}/publish")
def publish_runtime(
    technique_slug: str,
    publication: RuntimePublication,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    payload = PackagePayload(
        catalog=publication.catalog or _catalog_payload(technique),
        training_steps=publication.training_config,
        learning_content=publication.learning_content,
    )
    _, catalog, training, learning = _validate_payload(payload, technique_slug)
    technique.name = catalog["name"]
    technique.category = catalog["category"]
    technique.subcategory = catalog["subcategory"]
    technique.difficulty = catalog["difficulty"]
    technique.price = catalog["price"]
    technique.required_plan = catalog["required_plan"]
    technique.description = catalog["description"]
    technique.training_config = training
    technique.learning_content = learning
    technique.status = "active"
    _record_update(technique, admin, "runtime_publication")
    revision = _create_revision(db, technique, admin, "publish")
    db.commit()
    db.refresh(revision)
    return {"message": "Runtime technique published", "slug": technique.slug, "version": technique.version, "revision_id": revision.id}


@router.post("/{technique_slug}/revisions/{revision_id}/rollback")
def rollback_revision(
    technique_slug: str,
    revision_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    revision = db.query(TechniqueRevision).filter(
        TechniqueRevision.id == revision_id,
        TechniqueRevision.technique_id == technique.id,
    ).first()
    if not revision:
        raise HTTPException(404, "Technique revision not found")
    technique.training_config = deepcopy(revision.training_config)
    technique.learning_content = deepcopy(revision.learning_content)
    _record_update(technique, admin, "revision_rollback")
    restored = _create_revision(db, technique, admin, f"rollback:{revision_id}")
    db.commit()
    db.refresh(restored)
    return {"message": "Technique revision restored", "slug": technique.slug, "version": technique.version, "revision_id": restored.id}


@router.put("/{technique_slug}/training")
def update_training_config(
    technique_slug: str,
    training_config: dict = Body(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    payload = PackagePayload(
        catalog=_catalog_payload(technique),
        training_steps=training_config,
        learning_content=technique.learning_content,
    )
    _, _, validated_training, validated_learning = _validate_payload(payload, technique_slug)
    technique.training_config = validated_training
    technique.learning_content = validated_learning
    _record_update(technique, admin, "training_config")
    _create_revision(db, technique, admin, "training_update")
    db.commit()
    db.refresh(technique)
    return {
        "message": "Training configuration updated",
        "slug": technique.slug,
        "version": technique.version,
        "training_config": technique.training_config,
    }


@router.put("/{technique_slug}/learning")
def update_learning_content(
    technique_slug: str,
    learning_content: dict | None = Body(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    technique = _get_technique(db, technique_slug)
    payload = PackagePayload(
        catalog=_catalog_payload(technique),
        training_steps=technique.training_config or {},
        learning_content=learning_content,
    )
    _, _, validated_training, validated_learning = _validate_payload(payload, technique_slug)
    technique.training_config = validated_training
    technique.learning_content = validated_learning
    _record_update(technique, admin, "learning_content")
    _create_revision(db, technique, admin, "learning_update")
    db.commit()
    db.refresh(technique)
    return {
        "message": "Learning content updated",
        "slug": technique.slug,
        "version": technique.version,
        "learning_content": technique.learning_content,
    }
