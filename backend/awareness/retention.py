from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import os

from sqlalchemy.orm import Session

from models.awareness import AwarenessActionDelivery, AwarenessDecisionEvaluation, AwarenessEventRecord, AwarenessSession


def _days(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


@dataclass(frozen=True)
class AwarenessRetentionPolicy:
    sessions_days: int
    events_days: int
    evaluations_days: int
    deliveries_days: int


def retention_policy() -> AwarenessRetentionPolicy:
    return AwarenessRetentionPolicy(
        sessions_days=_days("AWARENESS_SESSION_RETENTION_DAYS", 30),
        events_days=_days("AWARENESS_EVENT_RETENTION_DAYS", 14),
        evaluations_days=_days("AWARENESS_EVALUATION_RETENTION_DAYS", 30),
        deliveries_days=_days("AWARENESS_DELIVERY_RETENTION_DAYS", 30),
    )


def retention_status() -> dict:
    return {"policy": asdict(retention_policy()), "raw_media_persisted": False}


def prune_awareness_data(db: Session, *, now: datetime | None = None, dry_run: bool = True) -> dict:
    current = now or datetime.now(timezone.utc)
    policy = retention_policy()
    event_cutoff = current - timedelta(days=policy.events_days)
    evaluation_cutoff = current - timedelta(days=policy.evaluations_days)
    delivery_cutoff = current - timedelta(days=policy.deliveries_days)
    session_cutoff = current - timedelta(days=policy.sessions_days)
    queries = {
        "events": db.query(AwarenessEventRecord).filter(AwarenessEventRecord.created_at < event_cutoff),
        "evaluations": db.query(AwarenessDecisionEvaluation).filter(AwarenessDecisionEvaluation.created_at < evaluation_cutoff),
        "deliveries": db.query(AwarenessActionDelivery).filter(AwarenessActionDelivery.created_at < delivery_cutoff),
        "sessions": db.query(AwarenessSession).filter(AwarenessSession.updated_at < session_cutoff),
    }
    counts = {name: query.count() for name, query in queries.items()}
    if not dry_run:
        # Children are removed first so this remains portable when SQLite foreign keys are disabled.
        queries["events"].delete(synchronize_session=False)
        queries["evaluations"].delete(synchronize_session=False)
        queries["deliveries"].delete(synchronize_session=False)
        queries["sessions"].delete(synchronize_session=False)
        db.commit()
    return {
        "dry_run": dry_run,
        "deleted": counts if not dry_run else {name: 0 for name in counts},
        "eligible": counts,
        "cutoffs": {
            "events": event_cutoff.isoformat(),
            "evaluations": evaluation_cutoff.isoformat(),
            "deliveries": delivery_cutoff.isoformat(),
            "sessions": session_cutoff.isoformat(),
        },
        **retention_status(),
    }
