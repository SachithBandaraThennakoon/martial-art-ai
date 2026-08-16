import json
from datetime import timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from models.awareness import AwarenessDecisionEvaluation, AwarenessEventRecord, AwarenessSession

from .schemas import AwarenessEvent, AwarenessSessionSummary, AwarenessSnapshot


def _event_signature(snapshot: AwarenessSnapshot) -> tuple:
    verified = tuple(sorted(item.object_id for item in snapshot.objects if item.verified))
    user = next((item for item in snapshot.objects if item.object_id == "user:primary"), None)
    action = user.state.l2 if user else {}
    feedback = snapshot.awareness.get("feedback_decision") or {}
    backend = snapshot.awareness.get("backend_inference") or {}
    return (
        verified,
        snapshot.awareness.get("situation_state"),
        action.get("step_id"),
        action.get("step_state"),
        feedback.get("type"),
        feedback.get("message"),
        backend.get("situation_state"),
        (backend.get("next_action") or {}).get("command"),
    )


def persist_snapshot(db: Session, snapshot: AwarenessSnapshot) -> AwarenessSnapshot:
    record = db.query(AwarenessSession).filter(
        AwarenessSession.user_id == snapshot.owner_user_id,
        AwarenessSession.session_key == snapshot.session_key,
    ).first()
    if record and snapshot.revision <= record.revision:
        return AwarenessSnapshot.model_validate_json(record.latest_snapshot)

    previous_snapshot = (
        AwarenessSnapshot.model_validate_json(record.latest_snapshot) if record else None
    )
    if record is None:
        record = AwarenessSession(
            user_id=snapshot.owner_user_id,
            session_key=snapshot.session_key,
            latest_snapshot=snapshot.model_dump_json(),
        )
        db.add(record)
        db.flush()

    record.schema_version = snapshot.schema_version
    record.revision = snapshot.revision
    record.latest_sequence = snapshot.sequence
    record.latest_snapshot = snapshot.model_dump_json()

    transition_changed = previous_snapshot is None or _event_signature(previous_snapshot) != _event_signature(snapshot)
    if transition_changed:
        verified = [item.object_id for item in snapshot.objects if item.verified]
        state = str(snapshot.awareness.get("situation_state") or "observing").replace("_", " ")
        db.add(AwarenessEventRecord(
            awareness_session_id=record.id,
            event_id=uuid4().hex,
            revision=snapshot.revision,
            event_type="world_transition",
            summary=f"{len(verified)} verified objects · {state}",
            data_json=json.dumps({
                "verified_object_ids": verified,
                "relationship_count": len(snapshot.relationships),
                "sequence": snapshot.sequence,
            }, separators=(",", ":")),
            occurred_at=snapshot.received_at,
        ))
        comparison = snapshot.metadata.get("decision_comparison") or {}
        if comparison.get("comparable"):
            client = comparison.get("client") or {}
            backend = comparison.get("backend") or {}
            agreement = comparison.get("agreement") or {}
            knowledge = (snapshot.metadata.get("world_model") or {}).get("knowledge") or {}
            db.add(AwarenessDecisionEvaluation(
                awareness_session_id=record.id,
                revision=snapshot.revision,
                client_state=client.get("situation_state"),
                backend_state=backend.get("situation_state"),
                client_command=client.get("command"),
                backend_command=backend.get("command"),
                state_agreement=agreement.get("state"),
                command_agreement=agreement.get("command"),
                backend_confidence=backend.get("confidence"),
                knowledge_profile_id=knowledge.get("profile_id") or "unknown",
                knowledge_version=knowledge.get("version") or "unknown",
            ))
    db.commit()
    return snapshot


def load_snapshot(db: Session, owner_user_id: int, session_key: str) -> AwarenessSnapshot | None:
    record = db.query(AwarenessSession).filter(
        AwarenessSession.user_id == owner_user_id,
        AwarenessSession.session_key == session_key,
    ).first()
    return AwarenessSnapshot.model_validate_json(record.latest_snapshot) if record else None


def load_events(
    db: Session, owner_user_id: int, session_key: str, limit: int = 50
) -> list[AwarenessEvent]:
    rows = db.query(AwarenessEventRecord).join(AwarenessSession).filter(
        AwarenessSession.user_id == owner_user_id,
        AwarenessSession.session_key == session_key,
    ).order_by(AwarenessEventRecord.revision.desc()).limit(max(1, min(limit, 200))).all()
    return [AwarenessEvent(
        event_id=row.event_id,
        session_key=session_key,
        revision=row.revision,
        event_type=row.event_type,
        occurred_at=row.occurred_at.replace(tzinfo=timezone.utc) if row.occurred_at.tzinfo is None else row.occurred_at,
        summary=row.summary,
        data=json.loads(row.data_json or "{}"),
    ) for row in rows]


def list_sessions(db: Session, owner_user_id: int) -> list[AwarenessSessionSummary]:
    rows = db.query(AwarenessSession).filter(
        AwarenessSession.user_id == owner_user_id
    ).order_by(AwarenessSession.updated_at.desc()).all()
    results = []
    for row in rows:
        snapshot = AwarenessSnapshot.model_validate_json(row.latest_snapshot)
        updated = row.updated_at
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        results.append(AwarenessSessionSummary(
            session_key=row.session_key,
            revision=row.revision,
            object_count=len(snapshot.objects),
            relationship_count=len(snapshot.relationships),
            last_received_at=updated,
        ))
    return results


def load_decision_evaluations(db: Session, owner_user_id: int, session_key: str, limit: int = 100):
    rows = db.query(AwarenessDecisionEvaluation).join(AwarenessSession).filter(
        AwarenessSession.user_id == owner_user_id,
        AwarenessSession.session_key == session_key,
    ).order_by(AwarenessDecisionEvaluation.revision.desc()).limit(max(1, min(limit, 500))).all()
    return [{
        "id": row.id,
        "revision": row.revision,
        "client_state": row.client_state,
        "backend_state": row.backend_state,
        "client_command": row.client_command,
        "backend_command": row.backend_command,
        "state_agreement": row.state_agreement,
        "command_agreement": row.command_agreement,
        "backend_confidence": row.backend_confidence,
        "knowledge_profile_id": row.knowledge_profile_id,
        "knowledge_version": row.knowledge_version,
        "created_at": row.created_at,
    } for row in rows]
