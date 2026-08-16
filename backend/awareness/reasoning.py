from typing import Any

from .attention import AttentionResult
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile


class DecisionPolicy:
    """Converts awareness and forecasts into an explainable, bounded action."""

    def __init__(self, knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE):
        self.knowledge = knowledge

    def decide(
        self,
        goal: dict[str, Any],
        awareness: dict[str, Any],
        prediction: dict[str, Any],
        attention: AttentionResult,
    ) -> dict[str, Any]:
        state = awareness.get("situation_state") or "waiting_for_perception"
        evidence = list(awareness.get("evidence") or [])
        reasons = [awareness.get("reason") or "No awareness reason supplied."]
        command = "observe"
        pause = False
        should_speak = False
        feedback_type = "none"
        message = "Continue observation while evidence is collected."
        priority = attention.focus.get("priority", 0)

        if state == "hazard_detected":
            command, pause, should_speak = "pause_and_review_hazard", True, True
            feedback_type = "safety"
            message = "Pause. A verified spatial hazard needs review before continuing."
            priority = 1
        elif state == "tracking_unclear":
            command, should_speak = "improve_camera_view", True
            feedback_type = "tracking"
            message = "Move fully into camera view so the system can verify your motion."
            priority = max(priority, .8)
        elif state == "correcting":
            command, should_speak = "hold_current_step", True
            feedback_type = "technique_correction"
            message = "Hold this step and correct the highest-priority supported issue."
            priority = max(priority, .75)
        elif state == "observing":
            command = "continue"
            message = "Continue while the system monitors current form and motion."

        forecast_risks = []
        for object_id, forecast in prediction.get("objects", {}).items():
            future = forecast.get("plus_1s", {})
            if future.get("trusted") and future.get("likely_mistake"):
                forecast_risks.append({"object_id": object_id, "risk": future["likely_mistake"]})
            session_future = forecast.get("session", {})
            if session_future.get("trusted") and float(session_future.get("fatigue_risk") or 0) >= .65:
                forecast_risks.append({"object_id": object_id, "horizon": "session", "risk": "fatigue"})
            long_future = forecast.get("long_term", {})
            if long_future.get("trusted") and long_future.get("evolution") == "degrading":
                forecast_risks.append({"object_id": object_id, "horizon": "long_term", "risk": "degradation"})
        for relationship_id, forecast in prediction.get("relationships", {}).items():
            future = forecast.get("plus_1s", {})
            if future.get("trusted") and future.get("collision_risk"):
                forecast_risks.append({"relationship_id": relationship_id, "risk": "collision"})
            if forecast.get("long_term", {}).get("trusted") and forecast["long_term"].get("evolution") == "degrading":
                forecast_risks.append({"relationship_id": relationship_id, "horizon": "long_term", "risk": "relationship_degradation"})
        if forecast_risks:
            reasons.append(f"{len(forecast_risks)} trusted future risk(s) affect the decision.")
            evidence.extend(forecast_risks)

        utility_weights = self.knowledge.utility_weights
        candidates = {
            "continue": {"defense": .45, "balance": .55, "power": .7, "mobility": .8, "exposure": .45, "joint_stress": .2, "energy_waste": .2},
            "hold_current_step": {"defense": .75, "balance": .8, "power": .25, "mobility": .25, "exposure": .2, "joint_stress": .15, "energy_waste": .25},
            "improve_camera_view": {"defense": .5, "balance": .6, "power": .1, "mobility": .55, "exposure": .25, "joint_stress": .05, "energy_waste": .1},
            "pause_and_review_hazard": {"defense": 1, "balance": .9, "power": 0, "mobility": .1, "exposure": .05, "joint_stress": .05, "energy_waste": .05},
            "observe": {"defense": .4, "balance": .5, "power": 0, "mobility": .3, "exposure": .3, "joint_stress": .05, "energy_waste": .05},
        }
        required = {
            "hazard_detected": "pause_and_review_hazard",
            "tracking_unclear": "improve_camera_view",
            "correcting": "hold_current_step",
            "observing": "continue",
            "waiting_for_perception": "observe",
        }.get(state)
        utilities = {}
        for candidate, metrics in candidates.items():
            value = sum(utility_weights[name] * metric for name, metric in metrics.items())
            if required and candidate != required:
                value -= 2
            if forecast_risks and candidate == "continue":
                value -= min(1.5, .4 * len(forecast_risks))
            utilities[candidate] = round(value, 4)
        selected_command = max(utilities, key=utilities.get)
        if selected_command != command:
            reasons.append(f"Utility policy selected {selected_command} over preliminary {command}.")
            command = selected_command
        pause = command == "pause_and_review_hazard"

        awareness_confidence = float(awareness.get("confidence") or 0)
        forecast_factor = min(1, prediction.get("trusted_forecast_count", 0))
        decision_confidence = max(0, min(1, awareness_confidence * .8 + forecast_factor * .2))
        actions = [
            {"channel": "visual", "command": "display_feedback", "payload": {"message": message, "type": feedback_type}},
            {"channel": "system", "command": command, "payload": {"pause_training": pause}},
        ]
        if should_speak:
            actions.append({"channel": "audio", "command": "speak", "payload": {"message": message}})
        if feedback_type == "safety":
            actions.append({"channel": "haptic", "command": "alert_pattern", "payload": {"pattern": "urgent_double"}, "delivery": "adapter_required"})
        return {
            "schema_version": "decision/v1",
            "goal_type": goal.get("type") or "improve_user_technique",
            "command": command,
            "pause_training": pause,
            "should_speak": should_speak,
            "feedback": {"type": feedback_type, "message": message},
            "priority": priority,
            "confidence": decision_confidence,
            "reasons": reasons,
            "evidence": evidence[:24],
            "forecast_risks": forecast_risks,
            "utility": {
                "objective": "maximize_defense_balance_power_mobility_minus_risk",
                "weights": utility_weights,
                "candidates": utilities,
                "selected": command,
            },
            "actions": actions,
        }
