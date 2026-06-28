def _format_angle(value):
    if value is None:
        return "not visible"

    return f"{int(round(value))} deg"


def _format_target(target):
    min_angle, max_angle = target
    return f"{int(round(min_angle))}-{int(round(max_angle))} deg"


def generate_feedback(analysis, max_points=3):
    if not analysis:
        return "Move into frame so I can read your form."

    issues = [
        item for item in analysis
        if item["issue"] in {"too_closed", "too_open", "missing"}
    ]
    good_parts = [item for item in analysis if item["issue"] == "good"]

    lines = []

    for item in sorted(issues, key=lambda entry: entry["severity"], reverse=True)[:max_points]:
        lines.append(
            f"{item['cue']} Current: {_format_angle(item['value'])}; "
            f"target: {_format_target(item['target'])}."
        )

    if good_parts and len(lines) < max_points:
        best = min(good_parts, key=lambda entry: entry["difference"])
        lines.append(
            f"Good {best['label']} position at {_format_angle(best['value'])}."
        )

    if not lines:
        return "Good form. Hold this position and keep breathing."

    return "\n".join(lines)
