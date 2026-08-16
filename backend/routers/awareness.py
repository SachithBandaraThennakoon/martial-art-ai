from collections import deque
import json
import os
import time

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from auth_context import get_user_from_token, require_admin_user
from awareness.schemas import AwarenessSnapshotInput
from awareness.store import awareness_store
from database import SessionLocal, get_db
from models.user import User
from sqlalchemy.orm import Session
from awareness.repository import list_sessions, load_decision_evaluations, load_events, load_snapshot, persist_snapshot
from awareness.world_model import world_model_engine
from awareness.knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile
from awareness.knowledge_repository import (
    active_profile, activate_profile, create_profile, list_profiles,
    record_payload, submit_profile,
)
from awareness.perception import PerceptionEnvelope, perception_fusion_engine, perception_module_status
from awareness.retention import prune_awareness_data, retention_status
from services.observability import record_awareness_snapshot


def _sync_active_knowledge(db: Session):
    profile = active_profile(db) or DEFAULT_KNOWLEDGE
    world_model_engine.configure(profile)
    return profile


router = APIRouter(prefix="/admin/awareness", tags=["Admin awareness"])
MAX_AWARENESS_MESSAGE_BYTES = 262_144
AWARENESS_WS_MESSAGES_PER_SECOND = max(1, int(os.getenv("AWARENESS_WS_MESSAGES_PER_SECOND", "10")))


def _process_snapshot(db: Session, owner_user_id: int, payload: AwarenessSnapshotInput, source: str):
    started = time.perf_counter()
    _sync_active_knowledge(db)
    previous_snapshot = load_snapshot(db, owner_user_id, payload.session_key)
    previous_awareness = (
        previous_snapshot.awareness.get("backend_inference", {}) if previous_snapshot else None
    )
    processed = world_model_engine.process(owner_user_id, payload, previous_awareness)
    snapshot = persist_snapshot(db, awareness_store.ingest(owner_user_id, processed))
    decision = snapshot.reasoning.get("backend_decision", {})
    inference = snapshot.awareness.get("backend_inference", {})
    record_awareness_snapshot(
        source=source,
        state=str(inference.get("situation_state", "unknown")),
        command=str(decision.get("command", "observe")),
        duration_ms=(time.perf_counter() - started) * 1000,
        verified_entities=sum(1 for item in snapshot.objects if item.verified),
    )
    return snapshot


@router.get("/sessions")
def list_awareness_sessions(
    admin: User = Depends(require_admin_user), db: Session = Depends(get_db)
):
    return list_sessions(db, admin.id)


@router.get("/perception/modules")
def get_perception_modules(admin: User = Depends(require_admin_user)):
    return perception_module_status()


@router.get("/retention")
def get_retention_policy(admin: User = Depends(require_admin_user)):
    return retention_status()


@router.post("/retention/prune")
def prune_retained_awareness(
    dry_run: bool = Query(default=True),
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    return prune_awareness_data(db, dry_run=dry_run)


@router.post("/sessions/{session_key}/perception")
def ingest_perception(
    session_key: str,
    envelope: PerceptionEnvelope,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    if envelope.session_key != session_key:
        raise HTTPException(status_code=400, detail="session key does not match payload")
    payload = perception_fusion_engine.fuse(envelope)
    return _process_snapshot(db, admin.id, payload, "perception_rest")


@router.get("/knowledge")
def get_awareness_knowledge(
    admin: User = Depends(require_admin_user), db: Session = Depends(get_db)
):
    profile = _sync_active_knowledge(db)
    return {"source": "database" if active_profile(db) else "bundled", "profile": profile}


@router.get("/knowledge/profiles")
def get_knowledge_profiles(
    admin: User = Depends(require_admin_user), db: Session = Depends(get_db)
):
    return [record_payload(record) for record in list_profiles(db)]


@router.post("/knowledge/profiles", status_code=201)
def create_knowledge_profile(
    profile: KnowledgeProfile,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    return record_payload(create_profile(db, admin.id, profile))


@router.post("/knowledge/profiles/{record_id}/submit")
def submit_knowledge_profile(
    record_id: int,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    return record_payload(submit_profile(db, record_id))


@router.post("/knowledge/profiles/{record_id}/activate")
def activate_knowledge_profile(
    record_id: int,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    record = activate_profile(db, record_id, admin.id)
    world_model_engine.configure(KnowledgeProfile.model_validate_json(record.payload_json))
    return record_payload(record)


@router.post("/knowledge/validate")
def validate_awareness_knowledge(
    profile: KnowledgeProfile, admin: User = Depends(require_admin_user)
):
    return {"valid": True, "profile": profile, "active": profile == DEFAULT_KNOWLEDGE}


@router.post("/sessions/{session_key}/snapshots")
def ingest_awareness_snapshot(
    session_key: str,
    payload: AwarenessSnapshotInput,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    if payload.session_key != session_key:
        raise HTTPException(status_code=400, detail="session key does not match payload")
    return _process_snapshot(db, admin.id, payload, "snapshot_rest")


@router.get("/sessions/{session_key}/snapshot")
def get_awareness_snapshot(
    session_key: str,
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    snapshot = load_snapshot(db, admin.id, session_key)
    if not snapshot:
        raise HTTPException(status_code=404, detail="awareness session not found")
    return snapshot


@router.get("/sessions/{session_key}/events")
def get_awareness_events(
    session_key: str,
    limit: int = Query(default=50, ge=1, le=200),
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    return load_events(db, admin.id, session_key, limit)


@router.get("/sessions/{session_key}/evaluations")
def get_decision_evaluations(
    session_key: str,
    limit: int = Query(default=100, ge=1, le=500),
    admin: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    return load_decision_evaluations(db, admin.id, session_key, limit)


@router.websocket("/stream")
async def awareness_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        authentication_text = await websocket.receive_text()
        if len(authentication_text.encode("utf-8")) > MAX_AWARENESS_MESSAGE_BYTES:
            await websocket.close(code=4409)
            return
        authentication = json.loads(authentication_text)
        if authentication.get("type") != "authenticate" or not authentication.get("token"):
            await websocket.send_json({"type": "error", "code": "authentication_required"})
            await websocket.close(code=4401)
            return

        with SessionLocal() as auth_db:
            user = get_user_from_token(auth_db, authentication["token"])
            if (user.role or "user").strip().lower() != "admin":
                await websocket.send_json({"type": "error", "code": "admin_required"})
                await websocket.close(code=4403)
                return
            owner_user_id = user.id

        await websocket.send_json({"type": "authenticated", "schema_version": "awareness/v1"})
        message_times = deque()
        while True:
            message_text = await websocket.receive_text()
            if len(message_text.encode("utf-8")) > MAX_AWARENESS_MESSAGE_BYTES:
                await websocket.send_json({"type": "error", "code": "message_too_large"})
                await websocket.close(code=4409)
                return
            now = time.monotonic()
            while message_times and now - message_times[0] >= 1:
                message_times.popleft()
            if len(message_times) >= AWARENESS_WS_MESSAGES_PER_SECOND:
                await websocket.send_json({"type": "error", "code": "rate_limited"})
                await websocket.close(code=4429)
                return
            message_times.append(now)
            message = json.loads(message_text)
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if message.get("type") not in {"snapshot", "perception"}:
                await websocket.send_json({"type": "error", "code": "unsupported_message"})
                continue
            try:
                payload = (
                    perception_fusion_engine.fuse(
                        PerceptionEnvelope.model_validate(message.get("payload"))
                    )
                    if message.get("type") == "perception"
                    else AwarenessSnapshotInput.model_validate(message.get("payload"))
                )
                with SessionLocal() as awareness_db:
                    snapshot = _process_snapshot(
                        awareness_db, owner_user_id, payload,
                        "perception_ws" if message.get("type") == "perception" else "snapshot_ws",
                    )
            except (ValidationError, PermissionError) as exc:
                await websocket.send_json({"type": "error", "code": "invalid_snapshot", "detail": str(exc)})
                continue
            await websocket.send_json({
                "type": "snapshot_ack",
                "session_key": snapshot.session_key,
                "sequence": snapshot.sequence,
                "revision": snapshot.revision,
                "received_at": snapshot.received_at.isoformat(),
                "backend_inference": snapshot.awareness.get("backend_inference", {}),
                "backend_prediction": snapshot.prediction.get("backend_prediction", {}),
                "backend_decision": snapshot.reasoning.get("backend_decision", {}),
                "decision_comparison": snapshot.metadata.get("decision_comparison", {}),
                "world_model": snapshot.metadata.get("world_model", {}),
                "objects": [item.model_dump(mode="json") for item in snapshot.objects],
                "relationships": [item.model_dump(mode="json") for item in snapshot.relationships],
                "attention": snapshot.attention,
            })
    except (WebSocketDisconnect, json.JSONDecodeError, HTTPException):
        return
