from math import dist
from typing import Any

from .schemas import WorldObject, WorldRelationship
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile


def _vector(value: Any) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return tuple(float(item) for item in value[:3])
    except (TypeError, ValueError):
        return None


def _project(position: tuple[float, ...], velocity: tuple[float, ...], horizon: float):
    if len(position) != len(velocity):
        return None
    return tuple(point + speed * horizon for point, speed in zip(position, velocity))


class MultihorizonPredictionEngine:
    """Evidence-gated L1, L2, relationship, and session forecasts."""

    def predict(
        self,
        objects: list[WorldObject],
        relationships: list[WorldRelationship],
    ) -> dict[str, Any]:
        object_predictions: dict[str, Any] = {}
        for item in objects:
            if not item.verified:
                continue
            l1, l2, l3, l4 = item.state.l1, item.state.l2, item.state.l3, item.state.l4
            position = _vector(item.attributes.get("position") or l1.get("position"))
            velocity = _vector(l1.get("velocity"))
            short_position = _project(position, velocity, self.knowledge.horizons.l1_seconds) if position and velocity else None
            one_second_position = _project(position, velocity, self.knowledge.horizons.l2_seconds) if position and velocity else None
            motion_confidence = float(l1.get("prediction_confidence") or item.confidence)
            likely_mistake = l2.get("likely_mistake") or {}
            mistake_risk = float(l2.get("mistake_risk") or 0)
            action_confidence = float(l2.get("step_probability") or l2.get("confidence") or 0)
            action_trusted = bool(
                l2.get("next_step_prediction")
                and max(action_confidence, mistake_risk) >= self.knowledge.thresholds.action_forecast_trust
            )
            object_predictions[item.object_id] = {
                "plus_100ms": {
                    "position": short_position,
                    "confidence": max(0, min(1, motion_confidence * .95)) if short_position else 0,
                    "trusted": bool(short_position and motion_confidence >= self.knowledge.thresholds.motion_forecast_trust),
                },
                "plus_1s": {
                    "position": one_second_position,
                    "next_action": l2.get("next_step_prediction"),
                    "likely_mistake": likely_mistake or None,
                    "confidence": max(action_confidence, mistake_risk),
                    "trusted": action_trusted,
                },
                "session": {
                    "pattern": (l3.get("repeated_mistake") or {}).get("issue") or (l3.get("repeated_patterns") or [None])[0],
                    "fatigue_risk": l3.get("fatigue_risk"),
                    "recommendation": l3.get("recommendation"),
                    "trusted": bool(l3.get("repetition_summary") or l3.get("repeated_mistake") or l3.get("repeated_patterns")),
                },
                "long_term": {
                    "evolution": l4.get("evolution"),
                    "persistent_state": l4.get("persistent_state"),
                    "learning": l4.get("learning"),
                    "degradation": l4.get("degradation"),
                    "sessions_observed": l4.get("sessions_observed", 0),
                    "trusted": int(l4.get("sessions_observed") or 0) >= 2,
                },
            }

        relation_predictions: dict[str, Any] = {}
        for relation in relationships:
            if not relation.verified:
                continue
            l1 = relation.state.l1
            relative_position = _vector(l1.get("relative_position"))
            relative_velocity = _vector(l1.get("relative_velocity"))
            future_relative = (
                _project(relative_position, relative_velocity, self.knowledge.horizons.l2_seconds)
                if relative_position and relative_velocity else None
            )
            current_distance = l1.get("distance")
            future_distance = dist((0,) * len(future_relative), future_relative) if future_relative else None
            collision_risk = bool(
                future_distance is not None
                and current_distance is not None
                and future_distance < float(current_distance)
                and future_distance <= self.knowledge.thresholds.predicted_collision_distance
            )
            relation_predictions[relation.relationship_id] = {
                "plus_1s": {
                    "distance": future_distance,
                    "collision_risk": collision_risk,
                    "trusted": future_relative is not None and relation.confidence >= self.knowledge.thresholds.relationship_confidence,
                    "confidence": relation.confidence if future_relative is not None else 0,
                },
                "session": {
                    "pattern": relation.state.l3.get("repeated_patterns"),
                    "behaviour": relation.state.l3.get("behaviour"),
                    "trusted": bool(relation.state.l3.get("repeated_patterns")),
                },
                "long_term": {
                    "evolution": relation.state.l4.get("evolution"),
                    "persistent_state": relation.state.l4.get("persistent_state"),
                    "sessions_observed": relation.state.l4.get("sessions_observed", 0),
                    "trusted": int(relation.state.l4.get("sessions_observed") or 0) >= 2,
                },
            }

        trusted = sum(
            1 for prediction in object_predictions.values()
            if prediction["plus_100ms"]["trusted"] or prediction["plus_1s"]["trusted"]
            or prediction["session"]["trusted"] or prediction["long_term"]["trusted"]
        ) + sum(
            1 for prediction in relation_predictions.values()
            if prediction["plus_1s"]["trusted"] or prediction["session"]["trusted"]
            or prediction["long_term"]["trusted"]
        )
        return {
            "schema_version": "prediction/v1",
            "horizons": {
                "l1_seconds": self.knowledge.horizons.l1_seconds,
                "l2_seconds": self.knowledge.horizons.l2_seconds,
                "l3": self.knowledge.horizons.l3_label,
                "l4": "cross-session",
            },
            "objects": object_predictions,
            "relationships": relation_predictions,
            "trusted_forecast_count": trusted,
            "gated": trusted == 0,
        }
    def __init__(self, knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE):
        self.knowledge = knowledge
