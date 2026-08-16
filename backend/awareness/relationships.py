from collections import Counter
from dataclasses import dataclass, field
from itertools import combinations
from math import dist, sqrt
from threading import RLock

from .schemas import TemporalState, WorldObject, WorldRelationship
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile


def _vector(value) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return tuple(float(item) for item in value[:3])
    except (TypeError, ValueError):
        return None


def _position(item: WorldObject):
    return _vector(item.attributes.get("position") or item.state.l1.get("position"))


def _velocity(item: WorldObject):
    return _vector(item.state.l1.get("velocity"))


def _dot(first: tuple[float, ...], second: tuple[float, ...]) -> float:
    return sum(a * b for a, b in zip(first, second))


class L1RelationshipEngine:
    """Builds evidence-backed spatial relationships and derives relational L1-L4."""

    def __init__(
        self,
        contact_threshold: float | None = None,
        knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE,
    ):
        configured = knowledge.thresholds.contact_distance if contact_threshold is None else contact_threshold
        self.contact_threshold = max(0, configured)
        self._history: dict[tuple[int, str], RelationshipHistory] = {}
        self._lock = RLock()

    def build(
        self,
        objects: list[WorldObject],
        explicit: list[WorldRelationship] | None = None,
        owner_user_id: int = 0,
        session_key: str = "default",
    ) -> list[WorldRelationship]:
        relationships = {item.relationship_id: item for item in (explicit or [])}
        verified = [item for item in objects if item.verified]
        for first, second in combinations(verified, 2):
            first_position = _position(first)
            second_position = _position(second)
            if first_position is None or second_position is None or len(first_position) != len(second_position):
                continue
            displacement = tuple(b - a for a, b in zip(first_position, second_position))
            distance_value = dist(first_position, second_position)
            first_velocity = _velocity(first)
            second_velocity = _velocity(second)
            relative_velocity = None
            closing_speed = None
            if first_velocity and second_velocity and len(first_velocity) == len(second_velocity) == len(displacement):
                relative_velocity = tuple(b - a for a, b in zip(first_velocity, second_velocity))
                magnitude = sqrt(_dot(displacement, displacement))
                if magnitude > 1e-9:
                    closing_speed = -_dot(relative_velocity, displacement) / magnitude

            relation_id = f"{first.object_id}<->{second.object_id}:spatial"
            l1 = {
                "distance": distance_value,
                "relative_position": displacement,
                "relative_velocity": relative_velocity,
                "closing_speed": closing_speed,
                "contact": distance_value <= self.contact_threshold,
                "time_to_contact": (
                    max(0.0, (distance_value - self.contact_threshold) / closing_speed)
                    if closing_speed is not None and closing_speed > 0 else None
                ),
                "reachability": distance_value <= max(
                    float(first.attributes.get("reach") or 0),
                    float(second.attributes.get("reach") or 0),
                ) if first.attributes.get("reach") or second.attributes.get("reach") else None,
                "support_relationship": (
                    distance_value <= self.contact_threshold
                    if {first.object_type, second.object_type}.intersection({"floor"}) else None
                ),
                "movement_restriction": (
                    distance_value <= self.contact_threshold * 3
                    if {first.object_type, second.object_type}.intersection({"wall"}) else None
                ),
            }
            relationships[relation_id] = WorldRelationship(
                relationship_id=relation_id,
                source_id=first.object_id,
                target_id=second.object_id,
                relationship_type="spatial",
                confidence=min(first.confidence, second.confidence),
                verified=True,
                state=TemporalState(l1=l1),
            )
        with self._lock:
            return [self._enrich(owner_user_id, session_key, relation) for relation in relationships.values()]

    def _enrich(self, owner: int, session: str, relation: WorldRelationship) -> WorldRelationship:
        key = (owner, relation.relationship_id)
        history = self._history.setdefault(key, RelationshipHistory())
        l1 = dict(relation.state.l1)
        contact = bool(l1.get("contact"))
        closing = float(l1.get("closing_speed") or 0)
        previous_contact = history.last_contact
        if contact and previous_contact is not True:
            interaction = "contact_started"
        elif not contact and previous_contact is True:
            interaction = "contact_ended"
        elif contact:
            interaction = "contact"
        elif closing > .03:
            interaction = "closing"
        elif closing < -.03:
            interaction = "separating"
        else:
            interaction = "stable"
        supplied_l2 = relation.state.l2
        action = supplied_l2.get("action") or supplied_l2.get("event") or interaction
        l2 = {
            "event": supplied_l2.get("event") or interaction,
            "action": action,
            "state_transition": None if history.last_event in {None, interaction} else f"{history.last_event}_to_{interaction}",
            "phase": supplied_l2.get("phase") or interaction,
            "direction": "approaching" if closing > 0 else "separating" if closing < 0 else "stable",
            "confidence": supplied_l2.get("confidence", relation.confidence),
            **supplied_l2,
        }
        history.events[interaction] += 1
        history.sessions.add(session)
        history.observations += 1
        dominant, count = history.events.most_common(1)[0]
        supplied_l3 = relation.state.l3
        l3 = {
            "repeated_patterns": supplied_l3.get("repeated_patterns") or ([dominant] if count >= 3 else []),
            "behaviour": supplied_l3.get("behaviour") or dominant,
            "frequency": dict(history.events),
            "adaptation": supplied_l3.get("adaptation") or "collecting",
            "session_state": supplied_l3.get("session_state") or interaction,
            "observations": history.observations,
            **supplied_l3,
        }
        supplied_l4 = relation.state.l4
        l4 = {
            "evolution": supplied_l4.get("evolution") or "stable",
            "long_term_pattern": supplied_l4.get("long_term_pattern") or dominant,
            "adaptation": supplied_l4.get("adaptation") or "stable",
            "persistent_state": supplied_l4.get("persistent_state") or dominant,
            "sessions_observed": len(history.sessions),
            "lifetime_observations": history.observations,
            **supplied_l4,
        }
        history.last_contact = contact
        history.last_event = interaction
        return relation.model_copy(update={"state": TemporalState(l1=l1, l2=l2, l3=l3, l4=l4)})

    def clear(self) -> None:
        with self._lock:
            self._history.clear()


@dataclass
class RelationshipHistory:
    events: Counter = field(default_factory=Counter)
    sessions: set[str] = field(default_factory=set)
    observations: int = 0
    last_contact: bool | None = None
    last_event: str | None = None
