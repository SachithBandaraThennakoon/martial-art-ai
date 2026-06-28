BODY_PART_LABELS = {
    "elbow_right": "right elbow",
    "elbow_left": "left elbow",
    "shoulder_right": "right shoulder",
    "shoulder_left": "left shoulder",
    "knee_right": "right knee",
    "knee_left": "left knee",
    "hip_right": "right hip",
    "hip_left": "left hip",
    "ankle_right": "right ankle",
    "ankle_left": "left ankle",
    "wrist_right": "right wrist",
    "wrist_left": "left wrist",
}


def _target_values(part):
    min_angle = getattr(part, "min_angle", None)
    max_angle = getattr(part, "max_angle", None)

    if min_angle is None:
        min_angle = getattr(part, "min", None)

    if max_angle is None:
        max_angle = getattr(part, "max", None)

    return float(min_angle), float(max_angle)


def _label(body_part):
    return BODY_PART_LABELS.get(body_part, body_part.replace("_", " "))


def analyze_movement(required_parts, live_angles):
    analysis = []

    for part in required_parts:
        body_part = part.body_part
        min_angle, max_angle = _target_values(part)
        value = live_angles.get(body_part)

        if value is None:
            analysis.append({
                "body_part": body_part,
                "label": _label(body_part),
                "issue": "missing",
                "value": None,
                "target": (min_angle, max_angle),
                "difference": None,
                "severity": 999,
                "cue": f"Bring your {_label(body_part)} into view."
            })
            continue

        value = float(value)

        if value < min_angle:
            difference = min_angle - value
            issue = "too_closed"
            cue = f"Open your {_label(body_part)} about {int(round(difference))} degrees."
        elif value > max_angle:
            difference = value - max_angle
            issue = "too_open"
            cue = f"Close your {_label(body_part)} about {int(round(difference))} degrees."
        else:
            target_center = (min_angle + max_angle) / 2
            difference = abs(value - target_center)
            issue = "good"
            cue = f"Keep your {_label(body_part)} steady."

        analysis.append({
            "body_part": body_part,
            "label": _label(body_part),
            "issue": issue,
            "value": value,
            "target": (min_angle, max_angle),
            "difference": difference,
            "severity": difference if issue != "good" else 0,
            "cue": cue
        })

    return analysis
