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
from models import user, technique, technique_step, target_angle, training_memory
from models.target_angle import TargetAngle
from models.training_memory import (
    TrainingFeedbackEvent,
    TrainingSession,
    TrainingStepAttempt,
    UserTrainingMemory,
)

# Routers
from routers import auth
from routers import technique as technique_router
from routers import subscription as subscription_router

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


# -----------------------------
# AUTH
# -----------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


class VoiceRequest(BaseModel):
    text: str
    voice: str = "cedar"


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
        print("✅ TOKEN OK:", email)

    except JWTError as e:
        print("❌ TOKEN ERROR:", str(e))
        await websocket.close()
        return

    await websocket.accept()

    db = None
    db_ready = False
    user_record = None
    training_session = None
    last_memory_save_time = 0

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

                if previous_step_key and previous_step_key == coach.current_step_key:
                    continue

                if previous_step_key and previous_step_key != coach.current_step_key:
                    coach._reset_temporal_focus(keep_ready=True)
                    coach.is_paused = False
                    coach.readiness_prompted = False
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
