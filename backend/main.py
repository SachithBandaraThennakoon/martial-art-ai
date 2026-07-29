from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
import os
import time
import zlib
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from jose import JWTError, jwt
import json

# DB
from database import engine, get_db, init_db, SessionLocal

# Models
from models import user, technique, technique_step, target_angle, training_memory, contact_message, body_calibration, password_reset_token
from models.body_calibration import BodyCalibration
from models.target_angle import TargetAngle
from models.training_memory import (
    PracticeRep,
    PracticeSession,
    PracticeSessionTape,
    TemporalLabelingDraft,
    TrainingFeedbackEvent,
    TrainingSession,
    TrainingStepAttempt,
    UserTrainingMemory,
)

# Routers
from routers import auth
from routers import technique as technique_router
from routers import subscription as subscription_router
from routers import contact as contact_router
from routers import dashboard as dashboard_router

# Services
from services.angle_service import compare_angles
from services.catalog_sync import ensure_session_technique_columns, sync_technique_catalog
from services.practice_analytics import (
    load_practice_analytics,
    upsert_practice_analytics,
)
from agents.master_orchestrator import MasterOrchestrator

# Security
from utils.security import SECRET_KEY, ALGORITHM

logger = logging.getLogger(__name__)

# -----------------------------
# INIT APP
# -----------------------------
app = FastAPI(title="AI Martial Platform")

# Create DB tables
DATABASE_READY = init_db()
if DATABASE_READY:
    try:
        ensure_session_technique_columns(engine)
        with SessionLocal() as catalog_db:
            sync_technique_catalog(catalog_db)
    except (SQLAlchemyError, OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Technique catalog synchronization failed: %s", exc)


# -----------------------------
# CORS (Frontend Connection)
# -----------------------------
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# ROUTERS
# -----------------------------
app.include_router(auth.router)
app.include_router(technique_router.router)
app.include_router(subscription_router.router)
app.include_router(contact_router.router)
app.include_router(dashboard_router.router)


# -----------------------------
# AUTH
# -----------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


class PracticeSessionRequest(BaseModel):
    technique_name: str
    step_key: str | None = None
    step_name: str | None = None
    target_reps: int = 5


class PracticeRepRequest(BaseModel):
    rep_number: int
    accuracy: float = 0
    duration_ms: int = 0
    speed_label: str | None = None
    quality_label: str | None = None
    focus_body_part: str | None = None
    issue: str | None = None


class PracticeCorrectedSummary(BaseModel):
    completed_reps: int
    clean_reps: int = 0
    average_accuracy: float = 0
    best_accuracy: float = 0
    average_rep_seconds: float = 0
    consistency_score: float = 0


class PracticeCompleteRequest(BaseModel):
    status: str = "completed"
    corrected_summary: PracticeCorrectedSummary | None = None


class PracticeTapeRequest(BaseModel):
    version: int = 1
    frame_rate: int = 30
    duration_ms: int = 0
    frames: list[dict]
    metadata: dict = Field(default_factory=dict)


class TemporalLabDraftRequest(BaseModel):
    payload: dict


class BodyCalibrationRequest(BaseModel):
    ratios: dict[str, float]
    sample_count: int
    stability_score: float


# -----------------------------
# ROOT
# -----------------------------
@app.get("/")
def root():
    return {
        "message": "AI Martial Platform Running",
        "database": "ready" if DATABASE_READY else "unavailable"
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "database": "ready" if DATABASE_READY else "unavailable"
    }


# -----------------------------
# PROTECTED TEST
# -----------------------------
@app.get("/protected")
def protected_route(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        return {"message": f"Hello {email}"}
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/profile/body-calibration")
def get_body_calibration(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    calibration = db.query(BodyCalibration).filter(
        BodyCalibration.user_id == user_record.id
    ).first()
    return {"calibration": _body_calibration_payload(calibration) if calibration else None}


@app.put("/profile/body-calibration")
def save_body_calibration(
    request: BodyCalibrationRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    ratios = {
        str(key)[:64]: round(float(value), 5)
        for key, value in request.ratios.items()
        if isinstance(value, (int, float)) and 0.05 <= float(value) <= 8
    }
    if len(ratios) < 4:
        raise HTTPException(status_code=400, detail="A complete body calibration is required")

    calibration = db.query(BodyCalibration).filter(
        BodyCalibration.user_id == user_record.id
    ).first()
    if not calibration:
        calibration = BodyCalibration(user_id=user_record.id, ratios_json="{}")
        db.add(calibration)

    calibration.ratios_json = json.dumps(ratios)
    calibration.sample_count = max(1, min(request.sample_count, 120))
    calibration.stability_score = max(0, min(float(request.stability_score), 100))
    db.commit()
    db.refresh(calibration)
    return {"calibration": _body_calibration_payload(calibration)}


@app.delete("/profile/body-calibration")
def delete_body_calibration(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    calibration = db.query(BodyCalibration).filter(
        BodyCalibration.user_id == user_record.id
    ).first()
    if calibration:
        db.delete(calibration)
        db.commit()
    return {"deleted": True}


@app.post("/practice/sessions")
def create_practice_session(
    request: PracticeSessionRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    target_reps = max(1, min(request.target_reps, 50))
    technique_name = request.technique_name.strip()[:160] or "Practice"
    technique_record = db.query(technique.Technique).filter(
        func.lower(technique.Technique.name) == technique_name.lower()
    ).first()
    session = PracticeSession(
        user_id=user_record.id,
        technique_id=technique_record.id if technique_record else None,
        technique_name=technique_name,
        step_key=str(request.step_key) if request.step_key is not None else None,
        step_name=(request.step_name or "").strip()[:160] or None,
        target_reps=target_reps,
        status="active"
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _practice_session_payload(session)


@app.post("/practice/sessions/{session_id}/reps")
def record_practice_rep(
    session_id: int,
    request: PracticeRepRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    session = _get_user_practice_session(db, user_record.id, session_id)
    rep = PracticeRep(
        practice_session_id=session.id,
        rep_number=max(1, request.rep_number),
        accuracy=max(0, min(request.accuracy, 100)),
        duration_ms=max(0, request.duration_ms),
        speed_label=(request.speed_label or "").strip()[:40] or None,
        quality_label=(request.quality_label or "").strip()[:40] or None,
        focus_body_part=(request.focus_body_part or "").strip()[:80] or None,
        issue=(request.issue or "").strip()[:80] or None
    )
    db.add(rep)
    db.commit()
    _refresh_practice_session_summary(db, session)
    db.refresh(rep)
    return {
        "rep": _practice_rep_payload(rep),
        "session": _practice_session_payload(session)
    }


@app.patch("/practice/sessions/{session_id}/complete")
def complete_practice_session(
    session_id: int,
    request: PracticeCompleteRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    session = _get_user_practice_session(db, user_record.id, session_id)
    session.status = "completed" if request.status != "cancelled" else "cancelled"
    if not session.ended_at:
        session.ended_at = func.now()
    _refresh_practice_session_summary(db, session)
    if request.corrected_summary:
        summary = request.corrected_summary
        session.completed_reps = max(
            0,
            min(summary.completed_reps, session.target_reps or 50)
        )
        session.clean_reps = max(
            0,
            min(summary.clean_reps, session.completed_reps)
        )
        session.average_accuracy = max(
            0,
            min(summary.average_accuracy, 100)
        )
        session.best_accuracy = max(0, min(summary.best_accuracy, 100))
        session.average_rep_seconds = max(
            0,
            min(summary.average_rep_seconds, 120)
        )
        session.consistency_score = max(
            0,
            min(summary.consistency_score, 100)
        )
        session.status = (
            "completed"
            if session.completed_reps >= (session.target_reps or 0)
            else "cancelled"
        )
        db.commit()
        db.refresh(session)
    return _practice_session_payload(session)


@app.put("/practice/sessions/{session_id}/tape")
def store_practice_session_tape(
    session_id: int,
    request: PracticeTapeRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    session = _get_user_practice_session(db, user_record.id, session_id)
    frame_count = len(request.frames)
    if frame_count > 9000:
        raise HTTPException(status_code=413, detail="Practice tape exceeds the frame limit")

    tape_document = request.model_dump()
    tape_document["version"] = max(1, min(request.version, 10))
    tape_document["frame_rate"] = max(1, min(request.frame_rate, 60))
    tape_document["duration_ms"] = max(0, request.duration_ms)
    raw_payload = json.dumps(
        tape_document,
        separators=(",", ":"),
        ensure_ascii=False
    ).encode("utf-8")
    if len(raw_payload) > 60 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Practice tape exceeds the storage limit")

    compressed_payload = zlib.compress(raw_payload, level=6)
    tape = db.query(PracticeSessionTape).filter(
        PracticeSessionTape.practice_session_id == session.id
    ).first()
    if not tape:
        tape = PracticeSessionTape(practice_session_id=session.id, payload=compressed_payload)
        db.add(tape)

    tape.version = tape_document["version"]
    tape.frame_rate = tape_document["frame_rate"]
    tape.frame_count = frame_count
    tape.duration_ms = tape_document["duration_ms"]
    tape.codec = "zlib-json"
    tape.payload = compressed_payload
    tape.uncompressed_bytes = len(raw_payload)
    tape.compressed_bytes = len(compressed_payload)
    analytics_payload = upsert_practice_analytics(
        db,
        session.id,
        {
            **request.metadata,
            "captureDurationMs": tape_document["duration_ms"],
            "canonicalCompletedReps": session.completed_reps,
            "canonicalTargetReps": session.target_reps,
        },
    )
    db.commit()
    db.refresh(tape)
    return {
        "stored": True,
        "session_id": session.id,
        "frame_count": tape.frame_count,
        "duration_ms": tape.duration_ms,
        "compressed_bytes": tape.compressed_bytes,
        "analytics": analytics_payload,
    }


@app.get("/practice/sessions/{session_id}/tape")
def get_practice_session_tape(
    session_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    session = _get_user_practice_session(db, user_record.id, session_id)
    tape = db.query(PracticeSessionTape).filter(
        PracticeSessionTape.practice_session_id == session.id
    ).first()
    if not tape:
        raise HTTPException(status_code=404, detail="No frame tape is stored for this session")

    try:
        document = json.loads(zlib.decompress(tape.payload).decode("utf-8"))
    except (zlib.error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.error("Stored practice tape %s could not be decoded: %s", tape.id, exc)
        raise HTTPException(status_code=500, detail="Stored practice tape is unavailable") from exc

    return {
        **document,
        "session": _practice_session_payload(session),
        "storage": {
            "compressed_bytes": tape.compressed_bytes,
            "uncompressed_bytes": tape.uncompressed_bytes,
            "created_at": tape.created_at.isoformat() if tape.created_at else None,
            "updated_at": tape.updated_at.isoformat() if tape.updated_at else None
        }
    }


@app.get("/admin/temporal-labeling/drafts/{technique_key}")
def get_temporal_labeling_draft(
    technique_key: str,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    if user_record.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    draft = db.query(TemporalLabelingDraft).filter(
        TemporalLabelingDraft.admin_user_id == user_record.id,
        TemporalLabelingDraft.technique_key == technique_key
    ).order_by(TemporalLabelingDraft.updated_at.desc()).first()
    if not draft:
        return {"found": False, "technique_key": technique_key, "payload": None}
    try:
        payload = json.loads(draft.payload)
    except json.JSONDecodeError:
        payload = {}
    return {
        "found": True,
        "technique_key": technique_key,
        "payload": payload,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


@app.put("/admin/temporal-labeling/drafts/{technique_key}")
def save_temporal_labeling_draft(
    technique_key: str,
    request: TemporalLabDraftRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    if user_record.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    normalized_key = technique_key.strip().lower()
    if not normalized_key or len(normalized_key) > 120:
        raise HTTPException(status_code=422, detail="Invalid technique key")
    draft = db.query(TemporalLabelingDraft).filter(
        TemporalLabelingDraft.admin_user_id == user_record.id,
        TemporalLabelingDraft.technique_key == normalized_key
    ).first()
    if not draft:
        draft = TemporalLabelingDraft(
            admin_user_id=user_record.id,
            technique_key=normalized_key,
            payload="{}"
        )
        db.add(draft)
    draft.payload = json.dumps(request.payload, separators=(",", ":"))
    db.commit()
    db.refresh(draft)
    return {
        "saved": True,
        "technique_key": normalized_key,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


@app.get("/practice/analysis")
def get_practice_analysis(
    technique_name: str | None = None,
    session_limit: int = 12,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    sessions_query = db.query(PracticeSession).filter(
        PracticeSession.user_id == user_record.id
    )
    selected_technique = (technique_name or "").strip()
    if selected_technique:
        sessions_query = sessions_query.filter(
            func.lower(PracticeSession.technique_name) == selected_technique.lower()
        )
    safe_session_limit = max(1, min(int(session_limit or 12), 100))
    sessions = sessions_query.order_by(
        PracticeSession.started_at.desc()
    ).limit(safe_session_limit).all()

    total_sessions = len(sessions)
    total_reps = sum(session.completed_reps or 0 for session in sessions)
    best_accuracy = max([session.best_accuracy or 0 for session in sessions] or [0])
    average_accuracy = (
        sum((session.average_accuracy or 0) for session in sessions) / total_sessions
        if total_sessions else 0
    )
    target_reps = sum(session.target_reps or 0 for session in sessions)
    clean_reps = sum(session.clean_reps or 0 for session in sessions)
    completion_rate = (total_reps / target_reps * 100) if target_reps else 0
    clean_rate = (clean_reps / total_reps * 100) if total_reps else 0
    average_rep_seconds = (
        sum((session.average_rep_seconds or 0) for session in sessions) / total_sessions
        if total_sessions else 0
    )
    average_consistency = (
        sum((session.consistency_score or 0) for session in sessions) / total_sessions
        if total_sessions else 0
    )

    session_ids = [session.id for session in sessions]
    session_analytics = load_practice_analytics(db, session_ids)
    reps = []
    if session_ids:
        reps = db.query(PracticeRep).filter(
            PracticeRep.practice_session_id.in_(session_ids)
        ).all()

    focus_counts = {}
    pace_counts = {}
    form_error_counts = {}
    for rep in reps:
        if rep.focus_body_part:
            focus_counts[rep.focus_body_part] = focus_counts.get(rep.focus_body_part, 0) + 1
        if rep.speed_label:
            pace_counts[rep.speed_label] = pace_counts.get(rep.speed_label, 0) + 1

    for analytics in session_analytics.values():
        for error in analytics.get("common_form_errors") or []:
            error_id = error.get("error_id")
            if error_id:
                form_error_counts[error_id] = (
                    form_error_counts.get(error_id, 0) + int(error.get("count") or 0)
                )

    tracking_values = [
        analytics.get("tracking_quality_percentage")
        for analytics in session_analytics.values()
        if analytics.get("tracking_quality_percentage") is not None
    ]
    response_values = [
        analytics.get("average_response_time_ms")
        for analytics in session_analytics.values()
        if analytics.get("average_response_time_ms") is not None
    ]
    aborted_reps = sum(
        int(analytics.get("aborted_repetitions") or 0)
        for analytics in session_analytics.values()
    )
    corrections_applied = sum(
        int(analytics.get("corrections_applied") or 0)
        for analytics in session_analytics.values()
    )
    step_duration_values = {}
    for analytics in session_analytics.values():
        for step, duration in (analytics.get("per_step_duration_ms") or {}).items():
            step_duration_values.setdefault(step, []).append(float(duration))
    average_step_durations = {
        step: round(sum(values) / len(values))
        for step, values in step_duration_values.items()
        if values
    }

    weak_focus = max(focus_counts, key=focus_counts.get) if focus_counts else None
    recent_sessions = list(reversed(sessions[:6]))
    trend = [
        {
            "session_id": session.id,
            "technique_name": session.technique_name,
            "average_accuracy": round(session.average_accuracy or 0, 1),
            "completed_reps": session.completed_reps or 0,
            "target_reps": session.target_reps or 0,
        }
        for session in recent_sessions
    ]
    latest = sessions[0] if sessions else None
    recommendation = "Start a fixed-count practice set."
    if latest:
        latest_analytics = session_analytics.get(latest.id) or {}
        latest_tracking = latest_analytics.get("tracking_quality_percentage")
        latest_errors = latest_analytics.get("common_form_errors") or []
        if latest_tracking is not None and latest_tracking < 70:
            recommendation = "Improve camera framing and lighting before judging form."
        elif latest_errors:
            readable_error = latest_errors[0]["error_id"].replace("_", " ")
            recommendation = f"Repeat the set slowly and focus on {readable_error}."
        elif (latest.average_accuracy or 0) >= 85 and latest.completed_reps >= latest.target_reps:
            recommendation = "Strong set. Return to Train or raise the count."
        elif latest.completed_reps < latest.target_reps:
            recommendation = "Finish the target count before increasing reps."
        else:
            recommendation = "Repeat the same count slowly for cleaner reps."

    training_sessions = db.query(TrainingSession).filter(
        TrainingSession.user_id == user_record.id
    )
    if selected_technique:
        training_sessions = training_sessions.filter(
            func.lower(TrainingSession.technique_name) == selected_technique.lower()
        )
    training_sessions = training_sessions.order_by(
        TrainingSession.started_at.desc()
    ).limit(12).all()
    training_ids = [session.id for session in training_sessions]
    training_feedback = []
    if training_ids:
        training_feedback = db.query(TrainingFeedbackEvent).filter(
            TrainingFeedbackEvent.session_id.in_(training_ids)
        ).order_by(TrainingFeedbackEvent.created_at.desc()).limit(120).all()

    issue_counts = {}
    body_part_counts = {}
    for event in training_feedback:
        if event.issue and event.issue not in {"complete", "hold_good", "observing"}:
            issue_counts[event.issue] = issue_counts.get(event.issue, 0) + 1
        if event.body_part:
            body_part_counts[event.body_part] = body_part_counts.get(event.body_part, 0) + 1

    completed_training = sum(1 for session in training_sessions if session.completed)
    training_accuracy = (
        sum((session.final_accuracy or 0) for session in training_sessions) / len(training_sessions)
        if training_sessions else 0
    )
    frequent_focus = max(body_part_counts, key=body_part_counts.get) if body_part_counts else None
    frequent_issue = max(issue_counts, key=issue_counts.get) if issue_counts else None
    training_recommendation = "Complete a guided Train session to unlock coaching insights."
    if training_sessions:
        if frequent_focus:
            readable_focus = frequent_focus.replace("_", " ")
            training_recommendation = f"Your most frequent coaching focus is {readable_focus}. Practice it slowly before adding speed."
        elif training_accuracy >= 85:
            training_recommendation = "Your guided form is strong. Use Practice mode to build repeatable reps."
        else:
            training_recommendation = "Repeat your latest guided session and hold each target before advancing."

    return {
        "scope": {
            "technique_name": selected_technique or None,
            "session_limit": safe_session_limit,
        },
        "summary": {
            "total_sessions": total_sessions,
            "total_reps": total_reps,
            "average_accuracy": round(average_accuracy, 1),
            "best_accuracy": round(best_accuracy, 1),
            "completion_rate": round(completion_rate, 1),
            "clean_rate": round(clean_rate, 1),
            "average_rep_seconds": round(average_rep_seconds, 1),
            "consistency_score": round(average_consistency, 1),
            "weak_focus": weak_focus,
            "pace_mix": pace_counts,
            "tracking_quality_percentage": round(
                sum(tracking_values) / len(tracking_values), 1
            ) if tracking_values else 0,
            "average_response_time_ms": round(
                sum(response_values) / len(response_values)
            ) if response_values else None,
            "aborted_reps": aborted_reps,
            "corrections_applied": corrections_applied,
            "common_form_errors": [
                {"error_id": key, "count": value}
                for key, value in sorted(
                    form_error_counts.items(),
                    key=lambda pair: pair[1],
                    reverse=True,
                )
            ],
            "per_step_duration_ms": average_step_durations,
            "trend": trend,
            "recommendation": recommendation
        },
        "training_summary": {
            "total_sessions": len(training_sessions),
            "completed_sessions": completed_training,
            "average_accuracy": round(training_accuracy, 1),
            "feedback_events": len(training_feedback),
            "frequent_focus": frequent_focus,
            "frequent_issue": frequent_issue,
            "recommendation": training_recommendation,
            "recent": [
                {
                    "id": session.id,
                    "technique_name": session.technique_name,
                    "mode": session.mode,
                    "accuracy": round(session.final_accuracy or 0, 1),
                    "completed": bool(session.completed),
                    "started_at": session.started_at.isoformat() if session.started_at else None,
                }
                for session in training_sessions[:5]
            ],
        },
        "sessions": [
            _practice_session_payload(
                session,
                session_analytics.get(session.id),
            )
            for session in sessions
        ]
    }


# -----------------------------
# WEBSOCKET (JWT PROTECTED)
# -----------------------------
@app.websocket("/ws/train")
async def train(websocket: WebSocket):

    import time

    token = websocket.query_params.get("token")

    await websocket.accept()

    if not token:
        try:
            auth_payload = json.loads(
                await asyncio.wait_for(websocket.receive_text(), timeout=8)
            )
            if auth_payload.get("type") != "authenticate":
                await websocket.close(code=1008, reason="Authentication required")
                return
            token = auth_payload.get("token")
        except WebSocketDisconnect:
            return
        except (asyncio.TimeoutError, json.JSONDecodeError):
            await websocket.close(code=1008, reason="Authentication required")
            return

    if not token:
        await websocket.close(code=1008, reason="Authentication required")
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            await websocket.close(code=1008)
            return

    except JWTError:
        logger.warning("Rejected WebSocket connection with an invalid token")
        await websocket.close(code=1008)
        return

    db = None
    db_ready = False
    user_record = None
    training_session = None
    last_memory_save_time = 0
    sent_initial_greeting = False

    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db_ready = True
    except SQLAlchemyError as exc:
        logger.warning("Training persistence is unavailable: %s", exc)

    if db_ready:
        user_record = db.query(user.User).filter(user.User.email == email).first()

    coach = MasterOrchestrator()
    if db_ready and user_record:
        _restore_coach_memory(db, user_record.id, coach)
        coach.student_name = _display_student_name(user_record)

    # -----------------------------
    # MEMORY (PAST 5 SECONDS)
    # -----------------------------
    angle_history = []
    history_duration = 5  # seconds

    # feedback control
    last_feedback_time = 0
    feedback_interval = 5

    last_feedback = ""
    last_body_part = None
    last_issue = None
    last_action = None

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)

            event_type = parsed.get("type", "training_frame")

            if event_type == "session_config":
                previous_step_key = coach.current_step_key
                previous_step_index = coach.current_step_index
                was_ready = coach.is_ready
                had_session_memory = bool(
                    coach.recent_user_messages
                    or coach.recent_feedback
                    or coach.completed_steps
                    or coach.current_step_key
                    or coach.state not in {"confirm_start", "waiting"}
                )
                coach.technique_name = parsed.get("technique_name") or coach.technique_name
                coach.mode = parsed.get("mode") or coach.mode
                coach.current_step_key = parsed.get("step_key")
                coach.current_step_name = parsed.get("step_name") or coach.current_step_name
                coach.current_step_index = parsed.get("step_index", coach.current_step_index) or 0
                coach.total_steps = parsed.get("total_steps", coach.total_steps) or 0
                if db_ready:
                    technique_record = db.query(technique.Technique).filter(
                        func.lower(technique.Technique.name) == coach.technique_name.lower()
                    ).first()
                    if not training_session:
                        training_session = TrainingSession(
                            user_id=user_record.id if user_record else None,
                            technique_id=technique_record.id if technique_record else None,
                            technique_name=coach.technique_name,
                            mode=coach.mode,
                        )
                        db.add(training_session)
                    else:
                        training_session.technique_name = coach.technique_name
                        training_session.technique_id = technique_record.id if technique_record else None
                        training_session.mode = coach.mode
                    db.commit()
                    db.refresh(training_session)

                if not sent_initial_greeting:
                    if coach.state in {"confirm_session_complete", "session_complete"}:
                        coach._reset_temporal_focus(keep_ready=True)
                        coach.state = "observe_pose"
                        coach.completed_steps.clear()
                        coach.last_accuracy = 0
                    message = coach.initial_greeting()
                    action = "confirm_start"
                    sent_initial_greeting = True
                elif previous_step_key and previous_step_key == coach.current_step_key:
                    continue
                elif previous_step_key and previous_step_key != coach.current_step_key:
                    coach._reset_temporal_focus(keep_ready=True)
                    coach.is_paused = False
                    coach.readiness_prompted = False
                    coach.pending_question = None
                    coach.state = "observe_pose"
                    coach.last_accuracy = 0
                    coach.last_spoken_message = ""
                    last_feedback = ""
                    last_body_part = None
                    last_issue = None
                    last_action = None
                    last_feedback_time = 0
                    if coach.current_step_index == 0 and previous_step_index > 0:
                        message = f"Start again. {coach.current_step_name}."
                    else:
                        message = f"Next step. {coach.current_step_name}."
                    action = "observe"
                elif had_session_memory or was_ready or coach.current_step_index > 0:
                    message = f"Resume {coach.current_step_name}."
                    action = "observe"
                else:
                    coach.is_ready = True
                    coach.is_paused = False
                    message = f"Start {coach.technique_name}."
                    action = "observe"

                coach_event = coach.panel_event(message, action=action)
                last_feedback = coach_event["summary"]
                last_body_part = coach_event.get("body_part")
                last_issue = coach_event.get("issue")
                last_action = coach_event.get("action")
                last_feedback_time = time.time()
                if db_ready and user_record:
                    _save_coach_memory(db, user_record.id, coach, coach_event)
                    last_memory_save_time = time.time()
                await websocket.send_text(json.dumps(coach_event))
                continue

            if event_type == "user_message":
                coach_event = coach.user_message(parsed.get("message", ""))
                last_feedback = coach_event["summary"]
                last_body_part = coach_event.get("body_part")
                last_issue = coach_event.get("issue")
                last_action = coach_event.get("action")
                last_feedback_time = time.time()
                if db_ready and user_record:
                    _save_coach_memory(db, user_record.id, coach, coach_event)
                    last_memory_save_time = time.time()
                await websocket.send_text(json.dumps(coach_event))
                continue

            if event_type == "coach_intelligence_context":
                coach_event = coach.intelligence_context_event(parsed)
                if db_ready and user_record:
                    _save_coach_memory(db, user_record.id, coach, coach_event)
                    last_memory_save_time = time.time()
                if coach_event:
                    last_feedback = coach_event["summary"]
                    last_body_part = coach_event.get("body_part")
                    last_issue = coach_event.get("issue")
                    last_action = coach_event.get("action")
                    last_feedback_time = time.time()
                    if db_ready and training_session:
                        _record_training_feedback(
                            db,
                            training_session.id,
                            coach.current_step_key,
                            coach.current_step_name,
                            coach_event
                        )
                    await websocket.send_text(json.dumps(coach_event))
                continue

            if event_type == "session_complete":
                coach_event = coach.complete_session()
                if db_ready and training_session:
                    training_session.completed = True
                    training_session.ended_at = func.now()
                    db.commit()
                if db_ready and user_record:
                    _save_coach_memory(db, user_record.id, coach, coach_event)
                    last_memory_save_time = time.time()
                await websocket.send_text(json.dumps(coach_event))
                continue

            step_id = parsed.get("step_id")
            step_name = parsed.get("step_name") or "selected step"
            live_angles = parsed.get("angles", {})
            required_parts_payload = parsed.get("required_parts") or []

            current_time = time.time()

            # -----------------------------
            # STORE HISTORY
            # -----------------------------
            angle_history.append({
                "time": current_time,
                "angles": live_angles
            })

            # remove old data
            angle_history = [
                x for x in angle_history
                if current_time - x["time"] <= history_duration
            ]

            # extract only angle dicts
            history_angles = [x["angles"] for x in angle_history]

            # -----------------------------
            # GET TARGET ANGLES
            # -----------------------------
            if required_parts_payload:
                required_parts = required_parts_payload
            elif db_ready and isinstance(step_id, int):
                required_parts = db.query(TargetAngle).filter(
                    TargetAngle.step_id == step_id
                ).all()
            else:
                required_parts = []

            coach_event = coach.movement_event(
                step_id,
                step_name,
                required_parts,
                live_angles
            )
            accuracy = coach_event["accuracy"]
            important_transition = coach_event.get("action") in {
                "ask_ready",
                "advance_step",
                "confirm_next",
                "session_complete_prompt",
                "restart_training",
                "switch_practice",
                "needs_targets",
                "complete",
            }
            feedback_due = current_time - last_feedback_time > feedback_interval
            passive_question_wait = bool(
                coach.pending_question
                and coach_event.get("action") == "waiting"
                and not coach_event.get("speak")
            )
            stale_completion_prompt = (
                last_action == "session_complete_prompt"
                and coach_event.get("action") in {"correct", "waiting"}
                and coach_event.get("issue") != "complete"
            )
            should_update_feedback = (
                important_transition
                or (feedback_due and not passive_question_wait)
                or not last_feedback
                or stale_completion_prompt
            )

            # -----------------------------
            # SUMMARY FEEDBACK (THROTTLED)
            # -----------------------------
            if should_update_feedback:
                last_feedback = coach_event["summary"]
                last_body_part = coach_event.get("body_part")
                last_issue = coach_event.get("issue")
                last_action = coach_event.get("action")
                last_feedback_time = current_time
                if db_ready and training_session:
                    _record_training_feedback(
                        db,
                        training_session.id,
                        step_id,
                        step_name,
                        coach_event
                    )
                    _record_step_attempt(
                        db,
                        training_session.id,
                        step_id,
                        step_name,
                        accuracy
                    )
                    if user_record:
                        _record_user_training_memory(db, user_record.id, coach_event)
                if db_ready and user_record and current_time - last_memory_save_time > 3:
                    _save_coach_memory(db, user_record.id, coach, coach_event)
                    last_memory_save_time = current_time
            else:
                coach_event["message"] = last_feedback
                coach_event["summary"] = last_feedback
                coach_event["feedback"] = [last_feedback]
                coach_event["speak"] = False

            # -----------------------------
            # SEND
            # -----------------------------
            coach_event["summary"] = coach_event["message"]
            coach_event["feedback"] = [coach_event["message"]]
            await websocket.send_text(json.dumps(coach_event))

    except WebSocketDisconnect:
        logger.debug("Training WebSocket disconnected")

    finally:
        if db_ready and db and training_session:
            training_session.final_accuracy = accuracy if "accuracy" in locals() else 0
            training_session.ended_at = func.now()
            db.commit()
        if db:
            db.close()

def _record_training_feedback(db, session_id, step_key, step_name, coach_event):
    db.add(TrainingFeedbackEvent(
        session_id=session_id,
        step_key=str(step_key or step_name),
        body_part=coach_event.get("body_part"),
        issue=coach_event.get("issue"),
        feedback_text=coach_event.get("summary") or "",
        accuracy=coach_event.get("accuracy") or 0
    ))
    db.commit()


def _display_student_name(user_record):
    if not user_record or not user_record.name:
        return None

    name = " ".join(str(user_record.name).strip().split())
    if not name:
        return None

    return name.split(" ")[0][:32]


def _get_user_from_token(db, token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload.get("sub")
    user_record = db.query(user.User).filter(user.User.email == email).first()
    if not user_record:
        raise HTTPException(status_code=401, detail="User not found")

    return user_record


def _body_calibration_payload(calibration):
    try:
        ratios = json.loads(calibration.ratios_json or "{}")
    except json.JSONDecodeError:
        ratios = {}

    return {
        "ratios": ratios,
        "sample_count": calibration.sample_count or 0,
        "stability_score": round(calibration.stability_score or 0, 1),
        "updated_at": calibration.updated_at.isoformat() if calibration.updated_at else None,
    }


def _get_user_practice_session(db, user_id, session_id):
    session = db.query(PracticeSession).filter(
        PracticeSession.id == session_id,
        PracticeSession.user_id == user_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Practice session not found")

    return session


def _refresh_practice_session_summary(db, session):
    reps = db.query(PracticeRep).filter(
        PracticeRep.practice_session_id == session.id
    ).order_by(PracticeRep.rep_number).all()

    completed_reps = len(reps)
    clean_reps = sum(1 for rep in reps if (rep.accuracy or 0) >= 80)
    average_accuracy = (
        sum((rep.accuracy or 0) for rep in reps) / completed_reps
        if completed_reps else 0
    )
    best_accuracy = max([(rep.accuracy or 0) for rep in reps] or [0])
    average_rep_seconds = (
        sum((rep.duration_ms or 0) for rep in reps) / completed_reps / 1000
        if completed_reps else 0
    )

    session.completed_reps = completed_reps
    session.clean_reps = clean_reps
    session.average_accuracy = average_accuracy
    session.best_accuracy = best_accuracy
    session.average_rep_seconds = average_rep_seconds
    session.consistency_score = _practice_consistency_score(reps)
    if session.status == "active" and completed_reps >= (session.target_reps or 0):
        session.status = "completed"
        session.ended_at = func.now()

    db.commit()
    db.refresh(session)


def _practice_consistency_score(reps):
    if len(reps) < 2:
        return 100 if reps else 0

    values = [rep.accuracy or 0 for rep in reps]
    average = sum(values) / len(values)
    variance = sum((value - average) ** 2 for value in values) / len(values)
    return max(0, min(100, 100 - (variance ** 0.5)))


def _practice_session_payload(session, analytics=None):
    payload = {
        "id": session.id,
        "technique_id": session.technique_id,
        "technique_name": session.technique_name,
        "step_key": session.step_key,
        "step_name": session.step_name,
        "target_reps": session.target_reps,
        "completed_reps": session.completed_reps,
        "clean_reps": session.clean_reps,
        "average_accuracy": round(session.average_accuracy or 0, 1),
        "best_accuracy": round(session.best_accuracy or 0, 1),
        "average_rep_seconds": round(session.average_rep_seconds or 0, 2),
        "consistency_score": round(session.consistency_score or 0, 1),
        "status": session.status,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
    }
    if analytics:
        payload["analytics"] = analytics
    return payload


def _practice_rep_payload(rep):
    return {
        "id": rep.id,
        "practice_session_id": rep.practice_session_id,
        "rep_number": rep.rep_number,
        "accuracy": round(rep.accuracy or 0, 1),
        "duration_ms": rep.duration_ms,
        "speed_label": rep.speed_label,
        "quality_label": rep.quality_label,
        "focus_body_part": rep.focus_body_part,
        "issue": rep.issue,
        "ended_at": rep.ended_at.isoformat() if rep.ended_at else None,
    }


def _record_step_attempt(db, session_id, step_key, step_name, accuracy):
    key = str(step_key or step_name)
    attempt = db.query(TrainingStepAttempt).filter(
        TrainingStepAttempt.session_id == session_id,
        TrainingStepAttempt.step_key == key
    ).first()

    if not attempt:
        attempt = TrainingStepAttempt(
            session_id=session_id,
            step_key=key,
            step_name=step_name,
            best_accuracy=accuracy,
            average_accuracy=accuracy,
            attempts_count=1,
            completed_at=func.now() if accuracy >= 100 else None
        )
        db.add(attempt)
    else:
        total = attempt.average_accuracy * attempt.attempts_count
        attempt.attempts_count += 1
        attempt.average_accuracy = (total + accuracy) / attempt.attempts_count
        attempt.best_accuracy = max(attempt.best_accuracy or 0, accuracy)
        if accuracy >= 100 and attempt.completed_at is None:
            attempt.completed_at = func.now()

    db.commit()


def _record_user_training_memory(db, user_id, coach_event):
    event_memory = coach_event.get("memory", {})
    memory_value = json.dumps({
        "attention_score": event_memory.get("attention_score"),
        "correction_frames": event_memory.get("correction_frames"),
        "plateau_frames": event_memory.get("plateau_frames"),
        "last_user_intent": event_memory.get("last_user_intent"),
        "pending_question": event_memory.get("pending_question"),
        "focus_body_part": coach_event.get("focus_body_part"),
        "last_action": coach_event.get("action"),
        "last_issue": coach_event.get("issue"),
    })

    memory = db.query(UserTrainingMemory).filter(
        UserTrainingMemory.user_id == user_id,
        UserTrainingMemory.memory_key == "coach_temporal_memory"
    ).first()

    if memory:
        memory.memory_value = memory_value
    else:
        db.add(UserTrainingMemory(
            user_id=user_id,
            memory_key="coach_temporal_memory",
            memory_value=memory_value
        ))

    db.commit()


def _save_coach_memory(db, user_id, coach, coach_event=None):
    memory_value = json.dumps({
        "coach": coach.to_memory(),
        "last_event": {
            "action": coach_event.get("action") if coach_event else None,
            "message": coach_event.get("message") if coach_event else None,
            "accuracy": coach_event.get("accuracy") if coach_event else None,
            "body_part": coach_event.get("body_part") if coach_event else None,
            "issue": coach_event.get("issue") if coach_event else None,
        }
    })

    memory = db.query(UserTrainingMemory).filter(
        UserTrainingMemory.user_id == user_id,
        UserTrainingMemory.memory_key == "coach_session_state"
    ).first()

    if memory:
        memory.memory_value = memory_value
    else:
        db.add(UserTrainingMemory(
            user_id=user_id,
            memory_key="coach_session_state",
            memory_value=memory_value
        ))

    db.commit()


def _restore_coach_memory(db, user_id, coach):
    memory = db.query(UserTrainingMemory).filter(
        UserTrainingMemory.user_id == user_id,
        UserTrainingMemory.memory_key == "coach_session_state"
    ).first()

    if not memory or not memory.memory_value:
        return

    try:
        payload = json.loads(memory.memory_value)
    except json.JSONDecodeError:
        return

    coach.restore_memory(payload.get("coach"))

@app.get("/steps/{step_id}/angles")
def get_angles(step_id: int, db: Session = Depends(get_db)):
    angles = db.query(TargetAngle).filter(
        TargetAngle.step_id == step_id
    ).all()

    return [
        {
            "body_part": a.body_part,
            "min": a.min_angle,
            "max": a.max_angle
        }
        for a in angles
    ]
