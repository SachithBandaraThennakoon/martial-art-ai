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
    "fist_right": "right fist",
    "fist_left": "left fist",
    "hand_right_open": "right hand",
    "hand_left_open": "left hand",
    "face_forward": "face direction",
    "eyes_forward": "eye focus",
    "face_calm": "facial tension",
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


def _is_score_part(body_part):
    return (
        body_part.startswith("fist_")
        or body_part.startswith("hand_")
        or body_part.startswith("face_")
        or body_part.startswith("eyes_")
    )


def _low_score_cue(body_part):
    if body_part.startswith("fist_"):
        return f"Curl your fingers into a tighter {_label(body_part)}."
    if body_part.startswith("hand_"):
        return f"Open your {_label(body_part)} and extend the fingers."
    if body_part == "face_forward":
        return "Look forward before the angle correction."
    if body_part == "eyes_forward":
        return "Keep your eyes forward before the angle correction."
    if body_part == "face_calm":
        return "Relax your face before the angle correction."

    return f"Increase {_label(body_part)}."


def _high_score_cue(body_part):
    if body_part.startswith("fist_"):
        return f"Relax your {_label(body_part)} slightly; it is tighter than needed."
    if body_part.startswith("hand_"):
        return f"Close your {_label(body_part)} slightly; it is too open for this target."

    return f"Ease {_label(body_part)} slightly."


def analyze_movement(required_parts, live_angles):
    analysis = []

    for part in required_parts:
        body_part = part.body_part
        min_angle, max_angle = _target_values(part)
        value = live_angles.get(body_part)

        if value is None:
            if body_part.startswith("fist_"):
                missing_cue = f"Show your {_label(body_part)} so I can read the fingers."
            elif body_part.startswith("hand_"):
                missing_cue = f"Show your {_label(body_part)} so I can read the open hand."
            else:
                missing_cue = f"Show your {_label(body_part)}."

            analysis.append({
                "body_part": body_part,
                "label": _label(body_part),
                "issue": "missing",
                "value": None,
                "target": (min_angle, max_angle),
                "difference": None,
                "degree_delta": None,
                "direction": "show",
                "severity": 999,
                "cue": missing_cue
            })
            continue

        value = float(value)

        if value < min_angle:
            difference = min_angle - value
            issue = "too_closed"
            direction = "increase"
            if _is_score_part(body_part):
                cue = _low_score_cue(body_part)
            else:
                cue = f"Increase {_label(body_part)} {int(round(difference))} degrees."
        elif value > max_angle:
            difference = value - max_angle
            issue = "too_open"
            direction = "decrease"
            if _is_score_part(body_part):
                cue = _high_score_cue(body_part)
            else:
                cue = f"Decrease {_label(body_part)} {int(round(difference))} degrees."
        else:
            target_center = (min_angle + max_angle) / 2
            difference = abs(value - target_center)
            issue = "good"
            direction = "hold"
            cue = f"Hold {_label(body_part)}."

        analysis.append({
            "body_part": body_part,
            "label": _label(body_part),
            "issue": issue,
            "value": value,
            "target": (min_angle, max_angle),
            "difference": difference,
            "degree_delta": int(round(difference)),
            "direction": direction,
            "unit": "score" if _is_score_part(body_part) else "degrees",
            "severity": difference if issue != "good" else 0,
            "cue": cue
        })

    return analysis
