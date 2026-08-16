from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime
from math import sqrt
from threading import RLock
from typing import Any

from .schemas import TemporalState, WorldObject


def _vector(value: Any) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return tuple(float(item) for item in value[:3])
    except (TypeError, ValueError):
        return None


def _difference(current, previous, seconds: float):
    if not current or not previous or len(current) != len(previous) or seconds <= 0:
        return None
    return tuple((current[index] - previous[index]) / seconds for index in range(len(current)))


def _magnitude(value) -> float:
    return sqrt(sum(component * component for component in value)) if value else 0.0


@dataclass
class ObjectHistory:
    samples: deque = field(default_factory=lambda: deque(maxlen=300))
    events: Counter = field(default_factory=Counter)
    sessions: set[str] = field(default_factory=set)
    total_observations: int = 0
    confidence_start: float | None = None
    confidence_latest: float = 0


class ObjectTemporalEngine:
    """Derives L1-L4 for every object while preserving detector/classifier evidence."""

    def __init__(self):
        self._histories: dict[tuple[int, str], ObjectHistory] = {}
        self._lock = RLock()

    def enrich(
        self, owner_user_id: int, session_key: str, captured_at: datetime,
        objects: list[WorldObject],
    ) -> list[WorldObject]:
        with self._lock:
            return [self._enrich_one(owner_user_id, session_key, captured_at, item) for item in objects]

    def _enrich_one(self, owner: int, session: str, captured_at: datetime, item: WorldObject) -> WorldObject:
        key = (owner, item.object_id)
        history = self._histories.setdefault(key, ObjectHistory())
        previous = history.samples[-1] if history.samples else None
        supplied = item.state
        position = _vector(item.attributes.get("position") or supplied.l1.get("position"))
        supplied_velocity = _vector(supplied.l1.get("velocity"))
        seconds = max(.001, (captured_at - previous["time"]).total_seconds()) if previous else 0
        velocity = supplied_velocity or (_difference(position, previous["position"], seconds) if previous else None)
        acceleration = _vector(supplied.l1.get("acceleration")) or (
            _difference(velocity, previous["velocity"], seconds) if previous else None
        )
        speed = _magnitude(velocity)
        previous_motion = previous["motion_state"] if previous else None
        motion_state = "stationary" if speed < .03 else "moving"
        l1 = {
            "position": position,
            "orientation": supplied.l1.get("orientation") or item.attributes.get("orientation"),
            "velocity": velocity,
            "acceleration": acceleration,
            "angular_velocity": supplied.l1.get("angular_velocity"),
            "speed": speed,
            "current_state": supplied.l1.get("current_state") or motion_state,
            "state_change": None if previous_motion in {None, motion_state} else f"{previous_motion}_to_{motion_state}",
            "confidence": item.confidence,
            **supplied.l1,
        }

        action = supplied.l2.get("action") or supplied.l2.get("event") or supplied.l2.get("step_state")
        if not action:
            if item.object_type in {"floor", "wall"}:
                action = "stable" if motion_state == "stationary" else "moving"
            else:
                action = motion_state
        transition = None if not previous or previous["action"] == action else f"{previous['action']}_to_{action}"
        l2 = {
            "event": supplied.l2.get("event") or action,
            "action": action,
            "state_transition": supplied.l2.get("state_transition") or transition,
            "phase": supplied.l2.get("phase") or supplied.l2.get("motion_phase") or (supplied.l2.get("temporal_segmentation") or {}).get("motion_phase") or motion_state,
            "direction": supplied.l2.get("direction"),
            "confidence": supplied.l2.get("confidence", item.confidence),
            **supplied.l2,
        }
        history.events[str(action)] += 1
        history.sessions.add(session)
        history.total_observations += 1
        history.confidence_start = item.confidence if history.confidence_start is None else history.confidence_start
        history.confidence_latest = item.confidence
        dominant, dominant_count = history.events.most_common(1)[0]
        repetition_rate = dominant_count / history.total_observations
        supplied_pattern = supplied.l3.get("repeated_patterns")
        repeated_mistake = supplied.l3.get("repeated_mistake") or {}
        l3 = {
            "repeated_patterns": supplied_pattern or ([repeated_mistake.get("issue")] if repeated_mistake.get("issue") else [dominant] if dominant_count >= 3 else []),
            "behaviour": supplied.l3.get("behaviour") or dominant,
            "frequency": dict(history.events),
            "errors": supplied.l3.get("errors") or ([supplied.l2.get("likely_mistake")] if supplied.l2.get("likely_mistake") else []),
            "adaptation": supplied.l3.get("adaptation") or "collecting",
            "fatigue_effect": supplied.l3.get("fatigue_effect") or supplied.l3.get("fatigue_risk", 0),
            "session_state": supplied.l3.get("session_state") or "active",
            "observations": history.total_observations,
            "dominant_pattern_rate": repetition_rate,
            **supplied.l3,
        }
        delta = item.confidence - (history.confidence_start or item.confidence)
        active_technique = supplied.l4.get("active_technique") or {}
        top_weakness = supplied.l4.get("top_weakness") or {}
        evolution = active_technique.get("learning_trend") or ("improving" if delta > .05 else "degrading" if delta < -.05 else "stable")
        l4 = {
            "evolution": supplied.l4.get("evolution") or evolution,
            "long_term_pattern": supplied.l4.get("long_term_pattern") or dominant,
            "learning": supplied.l4.get("learning") or max(0.0, delta),
            "degradation": supplied.l4.get("degradation") or max(0.0, -delta),
            "adaptation": supplied.l4.get("adaptation") or evolution,
            "persistent_state": supplied.l4.get("persistent_state") or top_weakness.get("issue") or dominant,
            "sessions_observed": len(history.sessions),
            "lifetime_observations": history.total_observations,
            **supplied.l4,
        }
        history.samples.append({
            "time": captured_at, "position": position, "velocity": velocity,
            "motion_state": motion_state, "action": action,
        })
        attributes = dict(item.attributes)
        attributes["temporal_engine"] = {"derived": True, "history_samples": len(history.samples)}
        return item.model_copy(update={"state": TemporalState(l1=l1, l2=l2, l3=l3, l4=l4), "attributes": attributes})

    def clear(self) -> None:
        with self._lock:
            self._histories.clear()
