from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
import time
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from jose import JWTError, jwt
import json

# DB
from database import get_db, init_db, SessionLocal

# Models
from models import user, technique, technique_step, target_angle, training_memory, contact_message
from models.target_angle import TargetAngle
from models.training_memory import (
    PracticeRep,
    PracticeSession,
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

# Services
from services.angle_service import compare_angles
from agents.master_orchestrator import MasterOrchestrator
from agents.voice_agent import generate_voice

# Security
from utils.security import SECRET_KEY, ALGORITHM




# -----------------------------
# INIT APP
# -----------------------------
app = FastAPI(title="AI Martial Platform")

# Create DB tables
DATABASE_READY = init_db()


# -----------------------------
# CORS (Frontend Connection)
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
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


# -----------------------------
# AUTH
# -----------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


class VoiceRequest(BaseModel):
    text: str
    voice: str = "cedar"


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


class PracticeCompleteRequest(BaseModel):
    status: str = "completed"


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


@app.post("/voice/speak")
def speak(request: VoiceRequest, token: str = Depends(oauth2_scheme)):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    audio = generate_voice(text[:600], request.voice)
    if not audio:
        raise HTTPException(status_code=503, detail="Voice service unavailable")

    return {
        "audio": audio,
        "format": "mp3",
        "voice": request.voice
    }


@app.post("/practice/sessions")
def create_practice_session(
    request: PracticeSessionRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    target_reps = max(1, min(request.target_reps, 50))
    session = PracticeSession(
        user_id=user_record.id,
        technique_name=request.technique_name.strip()[:160] or "Practice",
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
    session.ended_at = func.now()
    _refresh_practice_session_summary(db, session)
    return _practice_session_payload(session)


@app.get("/practice/analysis")
def get_practice_analysis(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    user_record = _get_user_from_token(db, token)
    sessions = db.query(PracticeSession).filter(
        PracticeSession.user_id == user_record.id
    ).order_by(PracticeSession.started_at.desc()).limit(12).all()

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
    reps = []
    if session_ids:
        reps = db.query(PracticeRep).filter(
            PracticeRep.practice_session_id.in_(session_ids)
        ).all()

    focus_counts = {}
    pace_counts = {}
    for rep in reps:
        if rep.focus_body_part:
            focus_counts[rep.focus_body_part] = focus_counts.get(rep.focus_body_part, 0) + 1
        if rep.speed_label:
            pace_counts[rep.speed_label] = pace_counts.get(rep.speed_label, 0) + 1

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
        if (latest.average_accuracy or 0) >= 85 and latest.completed_reps >= latest.target_reps:
            recommendation = "Strong set. Return to Train or raise the count."
        elif latest.completed_reps < latest.target_reps:
            recommendation = "Finish the target count before increasing reps."
        else:
            recommendation = "Repeat the same count slowly for cleaner reps."

    training_sessions = db.query(TrainingSession).filter(
        TrainingSession.user_id == user_record.id
    ).order_by(TrainingSession.started_at.desc()).limit(12).all()
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
        "sessions": [_practice_session_payload(session) for session in sessions]
    }


# -----------------------------
# WEBSOCKET (JWT PROTECTED)
# -----------------------------
@app.websocket("/ws/train")
async def train(websocket: WebSocket):

    import time

    token = websocket.query_params.get("token")

    if not token:
        await websocket.close()
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        print("WebSocket token accepted:", email)

    except JWTError as e:
        print("WebSocket token error:", str(e))
        await websocket.close()
        return

    await websocket.accept()

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
        print(f"Training persistence disabled: {exc}")

    if db_ready:
        user_record = db.query(user.User).filter(user.User.email == email).first()

    coach = MasterOrchestrator()
    if db_ready and user_record:
        _restore_coach_memory(db, user_record.id, coach)
        coach.student_name = _display_student_name(user_record)

    if db_ready:
        training_session = TrainingSession(
            user_id=user_record.id if user_record else None,
            technique_name=coach.technique_name,
            mode=coach.mode
        )
        db.add(training_session)
        db.commit()
        db.refresh(training_session)

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
                if db_ready and training_session:
                    training_session.technique_name = coach.technique_name
                    training_session.mode = coach.mode
                    db.commit()

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
            stale_completion_prompt = (
                last_action == "session_complete_prompt"
                and coach_event.get("action") in {"correct", "waiting"}
                and coach_event.get("issue") != "complete"
            )
            should_update_feedback = (
                important_transition
                or feedback_due
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
        print(f"{email} disconnected")

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


def _practice_session_payload(session):
    return {
        "id": session.id,
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
