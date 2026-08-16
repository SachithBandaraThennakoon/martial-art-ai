from typing import Any

from .attention import AttentionResult
from .schemas import WorldObject, WorldRelationship
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class AwarenessInferenceEngine:
    """Rule-based, evidence-auditable current awareness inference."""

    def infer(
        self,
        objects: list[WorldObject],
        relationships: list[WorldRelationship],
        attention: AttentionResult,
        previous_awareness: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        previous_awareness = previous_awareness or {}
        verified_objects = [item for item in objects if item.verified]
        verified_relationships = [item for item in relationships if item.verified]
        evidence: list[dict[str, Any]] = []
        if not verified_objects:
            return {
                "situation_state": "waiting_for_perception",
                "confidence": 0,
                "attention_target": attention.focus,
                "evidence": [],
                "reason": "No verified object evidence is available.",
                "previous_state": previous_awareness.get("situation_state"),
                "threats": [], "opportunities": [], "patterns": [], "uncertainty": 1,
                "next_action": {"command": "observe", "pause_training": False},
            }

        user = next((item for item in verified_objects if item.object_id == "user:primary"), None)
        tracking_confidence = user.confidence if user else max(item.confidence for item in verified_objects)
        mistake_risk = _number(user.state.l2.get("mistake_risk")) if user else 0
        hazards = []
        threats: list[dict[str, Any]] = []
        opportunities: list[dict[str, Any]] = []
        patterns: list[dict[str, Any]] = []
        for relation in verified_relationships:
            l1 = relation.state.l1
            closing = _number(l1.get("closing_speed"))
            contact = bool(l1.get("contact"))
            endpoint_types = {
                item.object_type.lower() for item in verified_objects
                if item.object_id in {relation.source_id, relation.target_id}
            }
            if contact or (
                closing > self.knowledge.thresholds.hazard_closing_speed
                and endpoint_types.intersection({"opponent", "weapon", "human"})
            ):
                hazards.append(relation)
                evidence.append({
                    "kind": "relationship",
                    "id": relation.relationship_id,
                    "contact": contact,
                    "closing_speed": closing,
                    "confidence": relation.confidence,
                })
                threats.append({"relationship_id": relation.relationship_id, "type": "collision_or_contact", "confidence": relation.confidence})

        for item in verified_objects:
            repeated = item.state.l3.get("repeated_patterns") or []
            persistent = item.state.l4.get("persistent_state")
            if repeated or persistent:
                patterns.append({"object_id": item.object_id, "session": repeated, "long_term": persistent})
            if item.object_id == "user:primary" and _number(item.state.l2.get("mistake_risk")) < .35:
                opportunities.append({"object_id": item.object_id, "type": "reinforce_stable_form", "confidence": item.confidence})

        if hazards:
            state = "hazard_detected"
            reason = "A verified relationship indicates contact or rapid closing motion."
            command = "hold_and_review"
            pause = True
        elif tracking_confidence < self.knowledge.thresholds.tracking_min_confidence:
            state = "tracking_unclear"
            reason = "Verified user tracking confidence is below the awareness gate."
            command = "improve_camera_view"
            pause = False
        elif mistake_risk >= self.knowledge.thresholds.mistake_risk:
            state = "correcting"
            reason = "The current action layer reports a high supported mistake risk."
            command = "hold_current_step"
            pause = False
            evidence.append({"kind": "object", "id": user.object_id, "mistake_risk": mistake_risk})
        else:
            state = "observing"
            reason = "Verified evidence is stable and no gated hazard is active."
            command = "continue"
            pause = False

        evidence.extend({
            "kind": "object",
            "id": item.object_id,
            "object_type": item.object_type,
            "confidence": item.confidence,
        } for item in verified_objects[:8])
        confidence = min(1.0, max(0.0, tracking_confidence * .7 + attention.focus["priority"] * .3))
        previous_state = previous_awareness.get("situation_state")
        return {
            "situation_state": state,
            "confidence": confidence,
            "attention_target": attention.focus,
            "evidence": evidence,
            "reason": reason,
            "previous_state": previous_state,
            "state_transition": None if previous_state in {None, state} else f"{previous_state}_to_{state}",
            "threats": threats,
            "opportunities": opportunities,
            "patterns": patterns,
            "uncertainty": 1 - confidence,
            "next_action": {"command": command, "pause_training": pause},
        }
    def __init__(self, knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE):
        self.knowledge = knowledge
