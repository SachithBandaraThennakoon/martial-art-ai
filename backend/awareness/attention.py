from dataclasses import dataclass
from typing import Any

from .schemas import WorldObject, WorldRelationship
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


@dataclass(frozen=True)
class AttentionResult:
    goal_type: str
    objects: dict[str, dict[str, Any]]
    relationships: dict[str, dict[str, Any]]
    focus: dict[str, Any]
    computation_budget: dict[str, str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "goal_type": self.goal_type,
            "objects": self.objects,
            "relationships": self.relationships,
            "focus": self.focus,
            "computation_budget": self.computation_budget,
        }


class AttentionEngine:
    def __init__(self, knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE):
        self.knowledge = knowledge

    def score(
        self,
        goal: dict[str, Any],
        objects: list[WorldObject],
        relationships: list[WorldRelationship],
    ) -> AttentionResult:
        goal_type = str(goal.get("type") or "improve_user_technique")
        weights = self.knowledge.goal_weights.get(
            goal_type, self.knowledge.goal_weights["improve_user_technique"]
        )
        object_scores: dict[str, dict[str, Any]] = {}
        for item in objects:
            identity = "user" if item.object_id == "user:primary" else item.object_type.lower()
            relevance = weights.get(identity, weights.get(item.object_type.lower(), 0.2))
            l1, l2, l3, l4 = item.state.l1, item.state.l2, item.state.l3, item.state.l4
            risk = max(
                _number(l2.get("mistake_risk")),
                _number(l2.get("threat_risk")),
                _number(l1.get("collision_risk")),
                _number(item.attributes.get("threat_score")),
            )
            confidence = item.confidence if item.verified else item.confidence * 0.25
            overall = _clamp(relevance * 0.55 + confidence * 0.3 + risk * 0.15)
            levels = {
                "l1": _clamp(overall + (0.12 if l1 else -0.08)),
                "l2": _clamp(overall + (0.1 if l2 else -0.12)),
                "l3": _clamp(overall + (0.08 if l3 else -0.18)),
                "l4": _clamp(overall + (0.06 if l4 else -0.22)),
            }
            reasons = [f"goal relevance {relevance:.2f}", f"confidence {item.confidence:.2f}"]
            if not item.verified:
                reasons.append("unverified evidence penalty")
            if risk > 0:
                reasons.append(f"risk {risk:.2f}")
            object_scores[item.object_id] = {
                "priority": overall,
                "levels": levels,
                "reasons": reasons,
                "verified": item.verified,
                "object_type": item.object_type,
            }

        relationship_scores: dict[str, dict[str, Any]] = {}
        for relation in relationships:
            source = object_scores.get(relation.source_id, {}).get("priority", 0)
            target = object_scores.get(relation.target_id, {}).get("priority", 0)
            l1 = relation.state.l1
            closing = max(0, _number(l1.get("closing_speed")))
            contact = bool(l1.get("contact"))
            risk_boost = min(0.25, closing * 0.1) + (0.2 if contact else 0)
            priority = _clamp(((source + target) / 2) * 0.8 + relation.confidence * 0.2 + risk_boost)
            reasons = [f"endpoint priority {((source + target) / 2):.2f}"]
            if closing > 0:
                reasons.append(f"closing speed {closing:.2f}")
            if contact:
                reasons.append("contact detected")
            relationship_scores[relation.relationship_id] = {
                "priority": priority,
                "levels": {
                    "l1": priority,
                    "l2": _clamp(priority - (0 if relation.state.l2 else 0.12)),
                    "l3": _clamp(priority - (0 if relation.state.l3 else 0.2)),
                    "l4": _clamp(priority - (0 if relation.state.l4 else 0.28)),
                },
                "reasons": reasons,
                "verified": relation.verified,
            }

        candidates = [
            (data["priority"], "object", identifier)
            for identifier, data in object_scores.items() if data["verified"]
        ] + [
            (data["priority"], "relationship", identifier)
            for identifier, data in relationship_scores.items() if data["verified"]
        ]
        top = max(candidates, default=(0, "none", None), key=lambda item: item[0])
        focus = {"kind": top[1], "id": top[2], "priority": top[0]}
        budgets = {
            identifier: "realtime" if data["priority"] >= .8 else "high" if data["priority"] >= .6 else "normal" if data["priority"] >= .35 else "deferred"
            for identifier, data in {**object_scores, **relationship_scores}.items()
        }
        return AttentionResult(goal_type, object_scores, relationship_scores, focus, budgets)
