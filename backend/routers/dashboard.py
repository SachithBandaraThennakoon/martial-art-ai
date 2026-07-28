from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from models.technique import Technique
from models.training_memory import PracticeRep, PracticeSession, TrainingFeedbackEvent, TrainingSession
from models.user import User
from services.practice_analytics import load_practice_analytics
from utils.security import ALGORITHM, SECRET_KEY


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        email = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("sub")
    except JWTError as error:
        raise HTTPException(status_code=401, detail="Invalid token") from error
    user = db.query(User).filter(User.email == email).first() if email else None
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def iso(value):
    return value.isoformat() if value else None


@router.get("")
def dashboard(
    date_from: date | None = None,
    date_to: date | None = None,
    mode: str = "all",
    category: str | None = None,
    subcategory: str | None = None,
    technique_name: str | None = None,
    difficulty: str | None = None,
    status: str = "all",
    accuracy_min: float | None = None,
    accuracy_max: float | None = None,
    focus: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Return filtered, user-scoped aggregates for every dashboard page."""
    today = datetime.now().date()
    start_date = date_from or today - timedelta(days=89)
    end_date = date_to or today
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="date_from must be before date_to")
    start_at = datetime.combine(start_date, datetime.min.time())
    end_at = datetime.combine(end_date + timedelta(days=1), datetime.min.time())

    techniques = db.query(Technique).order_by(Technique.category, Technique.subcategory, Technique.name).all()
    metadata = {
        item.name.lower(): {
            "category": item.category or "Uncategorized",
            "subcategory": item.subcategory or "General",
            "difficulty": item.difficulty or "Unspecified",
        }
        for item in techniques
    }
    metadata_by_id = {
        item.id: metadata[item.name.lower()]
        for item in techniques
    }
    selected_names = {
        item.name for item in techniques
        if (not category or item.category == category)
        and (not subcategory or item.subcategory == subcategory)
        and (not difficulty or item.difficulty == difficulty)
        and (not technique_name or item.name == technique_name)
    }
    selected_ids = {
        item.id for item in techniques
        if item.name in selected_names
    }
    taxonomy_filtered = any([category, subcategory, difficulty, technique_name])

    practice_query = db.query(PracticeSession).filter(
        PracticeSession.user_id == user.id,
        PracticeSession.started_at >= start_at,
        PracticeSession.started_at < end_at,
    )
    training_query = db.query(TrainingSession).filter(
        TrainingSession.user_id == user.id,
        TrainingSession.started_at >= start_at,
        TrainingSession.started_at < end_at,
        func.lower(TrainingSession.technique_name) != "this technique",
    )
    if taxonomy_filtered:
        names = selected_names or {"__none__"}
        ids = selected_ids or {-1}
        practice_query = practice_query.filter(or_(PracticeSession.technique_id.in_(ids), PracticeSession.technique_name.in_(names)))
        training_query = training_query.filter(or_(TrainingSession.technique_id.in_(ids), TrainingSession.technique_name.in_(names)))
    if status != "all":
        practice_query = practice_query.filter(PracticeSession.status == status)
        if status == "completed":
            training_query = training_query.filter(TrainingSession.completed.is_(True))
        elif status in {"active", "incomplete"}:
            training_query = training_query.filter(TrainingSession.completed.is_(False))
        else:
            training_query = training_query.filter(TrainingSession.id == -1)
    if accuracy_min is not None:
        practice_query = practice_query.filter(PracticeSession.average_accuracy >= accuracy_min)
        training_query = training_query.filter(TrainingSession.final_accuracy >= accuracy_min)
    if accuracy_max is not None:
        practice_query = practice_query.filter(PracticeSession.average_accuracy <= accuracy_max)
        training_query = training_query.filter(TrainingSession.final_accuracy <= accuracy_max)

    practice = practice_query.order_by(PracticeSession.started_at.desc()).limit(500).all() if mode in {"all", "practice"} else []
    training = training_query.order_by(TrainingSession.started_at.desc()).limit(500).all() if mode in {"all", "train"} else []
    practice_ids = [item.id for item in practice]
    training_ids = [item.id for item in training]
    reps = db.query(PracticeRep).filter(PracticeRep.practice_session_id.in_(practice_ids)).all() if practice_ids else []
    practice_analytics = load_practice_analytics(db, practice_ids)
    events = db.query(TrainingFeedbackEvent).filter(TrainingFeedbackEvent.session_id.in_(training_ids)).all() if training_ids else []

    if focus:
        practice_matches = {item.practice_session_id for item in reps if item.focus_body_part == focus}
        training_matches = {item.session_id for item in events if item.body_part == focus}
        practice = [item for item in practice if item.id in practice_matches]
        training = [item for item in training if item.id in training_matches]
        practice_ids = {item.id for item in practice}
        training_ids = {item.id for item in training}
        reps = [item for item in reps if item.practice_session_id in practice_ids]
        practice_analytics = {
            session_id: analytics
            for session_id, analytics in practice_analytics.items()
            if session_id in practice_ids
        }
        events = [item for item in events if item.session_id in training_ids]

    pace_counts, issue_counts, focus_counts = {}, {}, {}
    for item in reps:
        if item.speed_label:
            pace_counts[item.speed_label] = pace_counts.get(item.speed_label, 0) + 1
        if item.issue and item.issue != "good":
            issue_counts[item.issue] = issue_counts.get(item.issue, 0) + 1
        if item.focus_body_part:
            focus_counts[item.focus_body_part] = focus_counts.get(item.focus_body_part, 0) + 1
    for item in events:
        if item.issue and item.issue not in {"complete", "hold_good", "observing"}:
            issue_counts[item.issue] = issue_counts.get(item.issue, 0) + 1
        if item.body_part:
            focus_counts[item.body_part] = focus_counts.get(item.body_part, 0) + 1
    for analytics in practice_analytics.values():
        for error in analytics.get("common_form_errors") or []:
            error_id = error.get("error_id")
            if error_id:
                issue_counts[error_id] = (
                    issue_counts.get(error_id, 0) + int(error.get("count") or 0)
                )

    daily, technique_groups, sessions = {}, {}, []

    def technique_bucket(name, technique_id=None):
        info = metadata_by_id.get(technique_id) or metadata.get((name or "").lower(), {})
        return technique_groups.setdefault(name or "Unknown", {
            "name": name or "Unknown", "category": info.get("category", "Uncategorized"),
            "subcategory": info.get("subcategory", "General"), "difficulty": info.get("difficulty", "Unspecified"),
            "sessions": 0, "reps": 0, "clean_reps": 0, "accuracy_total": 0,
            "consistency_total": 0, "consistency_samples": 0,
            "tracking_total": 0, "tracking_samples": 0,
            "response_total": 0, "response_samples": 0, "aborted_reps": 0,
        })

    def record_day(timestamp, accuracy, rep_count=0, clean_count=0):
        if not timestamp:
            return
        key = timestamp.date().isoformat()
        item = daily.setdefault(key, {"date": key, "sessions": 0, "reps": 0, "clean_reps": 0, "accuracy_total": 0})
        item["sessions"] += 1
        item["reps"] += rep_count
        item["clean_reps"] += clean_count
        item["accuracy_total"] += accuracy

    for item in practice:
        accuracy = item.average_accuracy or 0
        rep_count, clean_count = item.completed_reps or 0, item.clean_reps or 0
        record_day(item.started_at, accuracy, rep_count, clean_count)
        group = technique_bucket(item.technique_name, item.technique_id)
        group["sessions"] += 1
        group["reps"] += rep_count
        group["clean_reps"] += clean_count
        group["accuracy_total"] += accuracy
        group["consistency_total"] += item.consistency_score or 0
        group["consistency_samples"] += 1
        analytics = practice_analytics.get(item.id) or {}
        tracking_quality = analytics.get("tracking_quality_percentage")
        response_time = analytics.get("average_response_time_ms")
        if tracking_quality is not None:
            group["tracking_total"] += tracking_quality
            group["tracking_samples"] += 1
        if response_time is not None:
            group["response_total"] += response_time
            group["response_samples"] += 1
        group["aborted_reps"] += int(analytics.get("aborted_repetitions") or 0)
        info = metadata_by_id.get(item.technique_id) or metadata.get((item.technique_name or "").lower(), {})
        capture_duration = analytics.get("capture_duration_ms")
        sessions.append({
            "id": f"practice-{item.id}", "mode": "practice", "technique_name": item.technique_name,
            "category": info.get("category", "Uncategorized"), "subcategory": info.get("subcategory", "General"),
            "difficulty": info.get("difficulty", "Unspecified"), "status": item.status,
            "accuracy": round(accuracy, 1), "reps": rep_count, "target_reps": item.target_reps or 0,
            "clean_reps": clean_count, "consistency": round(item.consistency_score or 0, 1),
            "duration_seconds": round(
                capture_duration / 1000
                if capture_duration
                else (item.average_rep_seconds or 0) * rep_count,
                1,
            ),
            "tracking_quality": round(tracking_quality, 1) if tracking_quality is not None else None,
            "average_response_time_ms": round(response_time) if response_time is not None else None,
            "aborted_reps": int(analytics.get("aborted_repetitions") or 0),
            "corrections_applied": int(analytics.get("corrections_applied") or 0),
            "form_errors": analytics.get("common_form_errors") or [],
            "started_at": iso(item.started_at), "ended_at": iso(item.ended_at),
        })

    for item in training:
        accuracy = item.final_accuracy or 0
        duration = max(0, (item.ended_at - item.started_at).total_seconds()) if item.ended_at and item.started_at else 0
        record_day(item.started_at, accuracy)
        group = technique_bucket(item.technique_name, item.technique_id)
        group["sessions"] += 1
        group["accuracy_total"] += accuracy
        info = metadata_by_id.get(item.technique_id) or metadata.get((item.technique_name or "").lower(), {})
        sessions.append({
            "id": f"train-{item.id}", "mode": "train", "technique_name": item.technique_name,
            "category": info.get("category", "Uncategorized"), "subcategory": info.get("subcategory", "General"),
            "difficulty": info.get("difficulty", "Unspecified"), "status": "completed" if item.completed else "incomplete",
            "accuracy": round(accuracy, 1), "reps": None, "target_reps": None, "clean_reps": None,
            "consistency": None, "duration_seconds": round(duration, 1),
            "started_at": iso(item.started_at), "ended_at": iso(item.ended_at),
        })

    daily_items = [{
        "date": item["date"], "sessions": item["sessions"], "reps": item["reps"], "clean_reps": item["clean_reps"],
        "average_accuracy": round(item["accuracy_total"] / item["sessions"], 1) if item["sessions"] else 0,
    } for item in sorted(daily.values(), key=lambda value: value["date"])]
    technique_items = [{
        "name": item["name"], "category": item["category"], "subcategory": item["subcategory"],
        "difficulty": item["difficulty"], "sessions": item["sessions"], "reps": item["reps"],
        "clean_reps": item["clean_reps"],
        "average_accuracy": round(item["accuracy_total"] / item["sessions"], 1) if item["sessions"] else 0,
        "clean_rate": round(item["clean_reps"] / item["reps"] * 100, 1) if item["reps"] else 0,
        "consistency": round(item["consistency_total"] / item["consistency_samples"], 1) if item["consistency_samples"] else 0,
        "tracking_quality": round(item["tracking_total"] / item["tracking_samples"], 1) if item["tracking_samples"] else None,
        "average_response_time_ms": round(item["response_total"] / item["response_samples"]) if item["response_samples"] else None,
        "aborted_reps": item["aborted_reps"],
    } for item in technique_groups.values()]
    technique_items.sort(key=lambda item: (item["average_accuracy"], item["sessions"]), reverse=True)
    sessions.sort(key=lambda item: item["started_at"] or "", reverse=True)

    accuracies = [item.average_accuracy or 0 for item in practice] + [item.final_accuracy or 0 for item in training]
    total_reps = sum(item.completed_reps or 0 for item in practice)
    clean_reps = sum(item.clean_reps or 0 for item in practice)
    duration_seconds = sum(item["duration_seconds"] for item in sessions)
    completed = sum(1 for item in sessions if item["status"] == "completed")
    tracking_values = [
        analytics.get("tracking_quality_percentage")
        for analytics in practice_analytics.values()
        if analytics.get("tracking_quality_percentage") is not None
    ]
    response_values = [
        analytics.get("average_response_time_ms")
        for analytics in practice_analytics.values()
        if analytics.get("average_response_time_ms") is not None
    ]
    aborted_reps = sum(
        int(analytics.get("aborted_repetitions") or 0)
        for analytics in practice_analytics.values()
    )
    recommendation = "Complete a session to unlock a training recommendation."
    if technique_items:
        weakest = min(technique_items, key=lambda item: item["average_accuracy"])
        recommendation = f"Prioritize {weakest['name']}. It has the lowest average form score in this view."

    taxonomy = {}
    for item in techniques:
        taxonomy.setdefault(item.category or "Uncategorized", {}).setdefault(item.subcategory or "General", []).append(item.name)

    return {
        "generated_at": datetime.now().isoformat(), "range": {"date_from": iso(start_date), "date_to": iso(end_date)},
        "overview": {
            "total_sessions": len(sessions), "completed_sessions": completed, "total_reps": total_reps,
            "average_accuracy": round(sum(accuracies) / len(accuracies), 1) if accuracies else 0,
            "best_accuracy": round(max(accuracies or [0]), 1), "clean_rate": round(clean_reps / total_reps * 100, 1) if total_reps else 0,
            "consistency": round(sum(item.consistency_score or 0 for item in practice) / len(practice), 1) if practice else 0,
            "training_minutes": round(duration_seconds / 60, 1), "active_days": len(daily_items),
            "tracking_quality": round(sum(tracking_values) / len(tracking_values), 1) if tracking_values else None,
            "average_response_time_ms": round(sum(response_values) / len(response_values)) if response_values else None,
            "aborted_reps": aborted_reps,
            "top_technique": technique_items[0]["name"] if technique_items else None, "recommendation": recommendation,
        },
        "daily": daily_items, "techniques": technique_items,
        "issues": [{"label": key, "count": value} for key, value in sorted(issue_counts.items(), key=lambda pair: pair[1], reverse=True)],
        "focus_areas": [{"label": key, "count": value} for key, value in sorted(focus_counts.items(), key=lambda pair: pair[1], reverse=True)],
        "pace": [{"label": key, "count": value} for key, value in sorted(pace_counts.items(), key=lambda pair: pair[1], reverse=True)],
        "sessions": sessions[:200], "filter_options": {"taxonomy": taxonomy, "focus_areas": sorted(focus_counts)},
    }
