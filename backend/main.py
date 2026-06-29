from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
import time
from sqlalchemy.orm import Session

from jose import JWTError, jwt
import json

# DB
from database import engine, Base, SessionLocal

# Models
from models import user, technique, technique_step, target_angle

# Routers
from routers import auth
from routers import technique as technique_router
from routers import subscription as subscription_router

# Services
from services.angle_service import compare_angles

# Security
from utils.security import SECRET_KEY, ALGORITHM




# -----------------------------
# INIT APP
# -----------------------------
app = FastAPI(title="AI Martial Platform")

# Create DB tables
Base.metadata.create_all(bind=engine)


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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -----------------------------
# ROOT
# -----------------------------
@app.get("/")
def root():
    return {"message": "AI Martial Platform Running"}


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


# -----------------------------
# WEBSOCKET (JWT PROTECTED)
# -----------------------------
@app.websocket("/ws/train")
async def train(websocket: WebSocket):

    import time
    from agents.summary_agent import summarize_movement

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

    db = SessionLocal()

    # -----------------------------
    # MEMORY (PAST 5 SECONDS)
    # -----------------------------
    angle_history = []
    history_duration = 5  # seconds

    # feedback control
    last_feedback_time = 0
    feedback_interval = 3

    last_feedback = "Start training"

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)

            step_id = parsed.get("step_id")
            live_angles = parsed.get("angles", {})

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
            required_parts = db.query(TargetAngle).filter(
                TargetAngle.step_id == step_id
            ).all()

            # -----------------------------
            # ACCURACY
            # -----------------------------
            correct = 0
            total = len(required_parts)

            for part in required_parts:
                value = live_angles.get(part.body_part)

                if value is None:
                    continue

                if part.min_angle <= value <= part.max_angle:
                    correct += 1

            accuracy = int((correct / total) * 100) if total > 0 else 0

            # -----------------------------
            # SUMMARY FEEDBACK (THROTTLED)
            # -----------------------------
            if current_time - last_feedback_time > feedback_interval:

                summary = summarize_movement(
                    history_angles,
                    live_angles,
                    required_parts
                )

                last_feedback = summary
                last_feedback_time = current_time

            # -----------------------------
            # SEND
            # -----------------------------
            await websocket.send_text(json.dumps({
                "accuracy": accuracy,
                "feedback": [last_feedback],
                "summary": last_feedback
            }))

    except WebSocketDisconnect:
        print(f"{email} disconnected")

    finally:
        db.close()



    import time

    token = websocket.query_params.get("token")

    # ❌ No token → reject
    if not token:
        await websocket.close()
        return

    # 🔐 Verify JWT
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        print("✅ TOKEN OK:", email)

    except JWTError as e:
        print("❌ TOKEN ERROR:", str(e))
        await websocket.close()
        return

    await websocket.accept()

    db = SessionLocal()

    # 🔥 FEEDBACK CONTROL
    last_feedback_time = 0
    feedback_interval = 2  # seconds
    last_feedback = "Start training"

    feedback_history = []
    MAX_HISTORY = 3

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)

            step_id = parsed.get("step_id")
            live_angles = parsed.get("angles", {})

            # -----------------------------
            # GET TARGET ANGLES
            # -----------------------------
            required_parts = db.query(TargetAngle).filter(
                TargetAngle.step_id == step_id
            ).all()

            # -----------------------------
            # 🎯 CALCULATE ACCURACY
            # -----------------------------
            correct = 0
            total = len(required_parts)

            for part in required_parts:
                value = live_angles.get(part.body_part)

                if value is None:
                    continue

                if part.min_angle <= value <= part.max_angle:
                    correct += 1

            accuracy = int((correct / total) * 100) if total > 0 else 0

            # -----------------------------
            # 🤖 RUN AGENTS (THROTTLED)
            # -----------------------------
            current_time = time.time()

            if current_time - last_feedback_time > feedback_interval:
                from agents.orchestrator import run_agents

                agent_result = run_agents(required_parts, live_angles)

                new_feedback = agent_result["feedback"]

                # store last 3 feedback batches
                feedback_history.append(new_feedback)

                if len(feedback_history) > MAX_HISTORY:
                    feedback_history.pop(0)

                last_feedback = new_feedback

                #summary_text = generate_summary(feedback_history)

                last_feedback_time = current_time

            # -----------------------------
            # SEND RESPONSE
            # -----------------------------
            await websocket.send_text(json.dumps({
                "accuracy": accuracy,
                "feedback": [last_feedback],
                "summary": summary_text
            }))

    except WebSocketDisconnect:
        print(f"{email} disconnected")

    finally:
        db.close()

from models.target_angle import TargetAngle

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
