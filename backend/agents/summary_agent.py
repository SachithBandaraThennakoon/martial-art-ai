from agents.coaching_agent import generate_feedback
from agents.movement_agent import analyze_movement


def summarize_movement(history, current_angles, required_parts):
    if not required_parts:
        return "No target angles are set for this step yet."

    if not current_angles:
        return "Move into frame so I can read your form."

    analysis = analyze_movement(required_parts, current_angles)
    feedback = generate_feedback(analysis, max_points=2)

    if history and len(history) >= 3:
        trend = _movement_trend(history, required_parts)
        if trend:
            return f"{feedback}\n{trend}"

    return feedback


def generate_summary(feedback_history):
    if not feedback_history:
        return "Start training."

    latest = feedback_history[-1]

    if isinstance(latest, list):
        return "\n".join(str(item) for item in latest[:2])

    return str(latest)


def _movement_trend(history, required_parts):
    first_frame = history[0]
    last_frame = history[-1]
    improving_parts = []

    for part in required_parts:
        body_part = part.body_part

        if body_part not in first_frame or body_part not in last_frame:
            continue

        min_angle = float(part.min_angle)
        max_angle = float(part.max_angle)
        center = (min_angle + max_angle) / 2
        first_diff = abs(float(first_frame[body_part]) - center)
        last_diff = abs(float(last_frame[body_part]) - center)

        if last_diff + 4 < first_diff:
            improving_parts.append(body_part.replace("_", " "))

    if not improving_parts:
        return ""

    return f"Improving: {improving_parts[0]} is moving closer to target."
