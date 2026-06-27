from collections import defaultdict

def summarize_movement(history, current_angles, required_parts):
    """
    history = list of past angle dicts [{elbow_right: 30, ...}, ...]
    current_angles = latest angles dict
    """

    if not history:
        return "Start training"

    # -----------------------------
    # CALCULATE AVERAGE (PAST)
    # -----------------------------
    avg_angles = defaultdict(float)
    count = defaultdict(int)

    for frame in history:
        for k, v in frame.items():
            avg_angles[k] += v
            count[k] += 1

    for k in avg_angles:
        avg_angles[k] /= count[k]

    # -----------------------------
    # FIND BEST + WORST
    # -----------------------------
    best_part = None
    worst_part = None

    best_diff = float("inf")
    worst_diff = -1

    for part in required_parts:
        body = part.body_part
        min_a = part.min_angle
        max_a = part.max_angle

        current = current_angles.get(body)
        avg = avg_angles.get(body)

        if current is None or avg is None:
            continue

        # distance from target center
        center = (min_a + max_a) / 2
        diff = abs(current - center)

        # BEST → smallest diff
        if diff < best_diff:
            best_diff = diff
            best_part = (body, current)

        # WORST → outside range
        if current < min_a:
            diff_bad = min_a - current
        elif current > max_a:
            diff_bad = current - max_a
        else:
            diff_bad = 0

        if diff_bad > worst_diff:
            worst_diff = diff_bad
            worst_part = (body, current, diff_bad)

    # -----------------------------
    # BUILD SENTENCE
    # -----------------------------
    if best_part and worst_part:
        good_body, good_val = best_part
        bad_body, bad_val, bad_diff = worst_part

        if bad_diff == 0:
            return f"Your {good_body} is good ({int(good_val)}), keep it up"

        direction = "increase" if bad_val < min_a else "decrease"

        return (
            f"Your {good_body} is good ({int(good_val)}), "
            f"but {bad_body} is bad ({int(bad_val)}), "
            f"{direction} {int(bad_diff)}"
        )

    return "Keep improving your form"