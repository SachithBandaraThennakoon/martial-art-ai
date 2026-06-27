def analyze_movement(required_parts, live_angles):
    analysis = []

    for part in required_parts:
        body = part.body_part
        min_a = part.min_angle
        max_a = part.max_angle

        value = live_angles.get(body)

        if value is None:
            continue

        # -----------------------------
        # OUTLIER FILTER
        # -----------------------------
        center = (min_a + max_a) / 2
        range_val = (max_a - min_a)

        lower_bound = center - 0.5 * range_val
        upper_bound = center + 0.5 * range_val

        if value < lower_bound or value > upper_bound:
            # 🚫 ignore extreme noise
            continue

        # -----------------------------
        # NORMAL ANALYSIS
        # -----------------------------
        if value < min_a:
            issue = "too_low"
        elif value > max_a:
            issue = "too_high"
        else:
            issue = "good"

        analysis.append({
            "body_part": body,
            "issue": issue,
            "value": value,
            "target": (min_a, max_a)
        })

    return analysis