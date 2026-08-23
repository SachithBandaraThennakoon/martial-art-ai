"""Deterministic, rule-based feedback framing for the awareness decision."""

from __future__ import annotations

from typing import Any


FEEDBACK_MODES = {"live", "step", "repetition", "session", "evolution"}
FEEDBACK_STRATEGIES = {"framework", "agent"}
DEFAULT_FEEDBACK_MODE = "live"
DEFAULT_FEEDBACK_STRATEGY = "framework"


def _side(body_part: str) -> str:
    if body_part.endswith("_left"):
        return "lead"
    if body_part.endswith("_right"):
        return "rear"
    return ""


def _part_name(body_part: str) -> str:
    side = _side(body_part)
    joint = body_part.removesuffix("_left").removesuffix("_right").replace("_", " ")
    return " ".join(value for value in (side, joint) if value).strip() or "form"


def _correction_cue(mistake: dict[str, Any]) -> tuple[str, str]:
    """Return one actionable cue and one biomechanical reason."""
    explicit = str(mistake.get("correction") or "").strip()
    body_part = str(mistake.get("body_part") or "")
    issue = str(mistake.get("issue") or "")
    part = _part_name(body_part)

    if explicit:
        cue = explicit.rstrip(".?!") + "."
    elif issue == "missing":
        cue = f"Show your {part} clearly, then hold still for a moment."
    elif "fist" in body_part:
        cue = f"Close your {part} firmly without squeezing the wrist."
    elif body_part.startswith("hand_"):
        cue = f"Show your {part} clearly and set it back in guard."
    elif "wrist" in body_part:
        cue = f"Straighten your {part} so the knuckles and forearm line up."
    elif "elbow" in body_part:
        cue = (
            f"Extend your {part} slightly more, without locking it."
            if issue == "too_closed"
            else f"Soften your {part} and bring it back into structure."
        )
    elif "knee" in body_part:
        cue = (
            f"Straighten your {part} slightly."
            if issue == "too_closed"
            else f"Bend your {part} slightly more."
        )
    elif "hip" in body_part:
        cue = (
            f"Open your {part} slightly."
            if issue == "too_closed"
            else f"Settle your {part} back into the stance."
        )
    elif "ankle" in body_part:
        cue = f"Plant your {part} and keep steady pressure through the floor."
    elif "shoulder" in body_part:
        cue = f"Relax and align your {part}; keep it away from your ear."
    elif "eyes" in body_part:
        cue = "Keep your eyes calmly on the target."
    elif "face" in body_part:
        cue = "Face the target and relax your jaw."
    elif body_part:
        cue = f"Adjust your {part}, then hold the corrected shape."
    else:
        cue = "Reset your stance and repeat the movement slowly."

    if any(value in body_part for value in ("knee", "ankle")):
        purpose = "This gives you a stable base."
    elif "hip" in body_part:
        purpose = "This connects the stance to your strike."
    elif any(value in body_part for value in ("fist", "hand")):
        purpose = "This keeps the guard ready and the hand protected."
    elif "wrist" in body_part:
        purpose = "This protects the joint and lines up the strike."
    elif "elbow" in body_part:
        purpose = "This keeps the arm strong without locking it."
    elif "shoulder" in body_part:
        purpose = "This preserves reach without losing posture."
    else:
        purpose = "This keeps the movement connected."
    return cue, purpose


def normalize_feedback_mode(value: Any) -> str:
    mode = str(value or DEFAULT_FEEDBACK_MODE).strip().lower()
    return mode if mode in FEEDBACK_MODES else DEFAULT_FEEDBACK_MODE


def normalize_feedback_strategy(value: Any) -> str:
    strategy = str(value or DEFAULT_FEEDBACK_STRATEGY).strip().lower()
    return strategy if strategy in FEEDBACK_STRATEGIES else DEFAULT_FEEDBACK_STRATEGY


def build_feedback_frame(
    *,
    mode: Any,
    goal: dict[str, Any],
    awareness: dict[str, Any],
    feedback_type: str,
    message: str,
    priority: float,
    confidence: float,
    forecast_risks: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create a bounded, explainable frame before any natural-language rendering."""
    normalized_mode = normalize_feedback_mode(mode)
    strategy = normalize_feedback_strategy(goal.get("feedback_strategy"))
    likely_mistake = awareness.get("likely_mistake") or {}
    context = awareness.get("context") or {}
    correction = likely_mistake.get("correction") or message
    return {
        "schema_version": "feedback/v2",
        "mode": normalized_mode,
        "strategy": strategy,
        "technique": goal.get("technique"),
        "step": context.get("step") or awareness.get("step") or None,
        "state": awareness.get("situation_state") or "observing",
        "what_is_correct": awareness.get("what_is_correct") or [],
        "primary_problem": likely_mistake.get("issue") or (feedback_type if feedback_type != "none" else None),
        "primary_problem_detail": {
            key: likely_mistake.get(key)
            for key in ("body_part", "label", "issue", "error", "value", "target_min", "target_max")
            if likely_mistake.get(key) is not None
        },
        "secondary_problems": awareness.get("secondary_problems") or [],
        "numerical_difference": awareness.get("difference_vector") or {},
        "correction": correction,
        "why_it_matters": likely_mistake.get("why") or None,
        "transition": awareness.get("next_step") or None,
        "message": message,
        "priority": round(max(0, min(1, float(priority or 0))), 4),
        "confidence": round(max(0, min(1, float(confidence or 0))), 4),
        "forecast_risks": forecast_risks[:8],
        "safety_locked": feedback_type == "safety",
        "teaching_policy": {
            "focus": "one_supported_correction",
            "sequence": ["cue", "practice", "confirm", "advance"],
            "llm_used": False,
        },
    }


def render_feedback(frame: dict[str, Any]) -> dict[str, Any]:
    """Render feedback from validated rules only; no network or LLM calls."""
    if frame.get("strategy") != "framework":
        return {"message": frame["message"], "renderer": "deterministic", "fallback": False}

    state = frame.get("state")
    if frame.get("safety_locked"):
        message = "Pause now. Check the space around you before continuing."
    elif state == "tracking_unclear":
        message = "Step back and show your full body. Hold still until tracking returns."
    elif state == "correcting":
        cue, purpose = _correction_cue({
            "body_part": (frame.get("primary_problem_detail") or {}).get("body_part"),
            "issue": frame.get("primary_problem"),
            "correction": frame.get("correction") if frame.get("correction") != frame.get("message") else None,
        })
        message = f"{cue} {purpose}"
    else:
        message = frame["message"]
    return {
        "message": message,
        "renderer": "deterministic-teaching-framework",
        "fallback": False,
    }


class FeedbackAgent:
    """Routes a validated feedback frame through the selected renderer."""

    def render(self, frame: dict[str, Any]) -> dict[str, Any]:
        return render_feedback(frame)


feedback_agent = FeedbackAgent()
