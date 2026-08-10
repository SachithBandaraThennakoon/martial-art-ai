"""Style-independent combat-guard anchor for static pose optimization."""


GUARD_ANCHOR_VERSION = "1.0.0"
GUARD_TARGET_RANGES = {
    "left_elbow_flexion": (50, 115, 55),
    "right_elbow_flexion": (50, 115, 55),
    "left_shoulder_angle": (15, 95, 55),
    "right_shoulder_angle": (15, 95, 55),
    "left_hip_angle": (95, 175, 55),
    "right_hip_angle": (95, 175, 55),
    "left_knee_flexion": (105, 170, 60),
    "right_knee_flexion": (105, 170, 60),
    "left_ankle_angle": (60, 140, 55),
    "right_ankle_angle": (60, 140, 55),
    "torso_lean": (0, 18, 35),
    "pelvis_rotation": (-45, 45, 40),
    "shoulder_rotation": (-45, 45, 40),
    "stance_width": (0.60, 1.45, 0.80),
    "stance_depth": (0.20, 1.30, 0.90),
    "guard_width": (0.20, 1.05, 1.00),
    "guard_height": (0.50, 1.30, 0.90),
    "left_hand_head_distance": (0.15, 0.80, 1.10),
    "right_hand_head_distance": (0.15, 0.80, 1.10),
    "left_hand_head_height": (-0.75, 0.05, 1.10),
    "right_hand_head_height": (-0.75, 0.05, 1.10),
}
GUARD_TARGET_WEIGHTS = {
    "left_hand_head_distance": 4.0,
    "right_hand_head_distance": 4.0,
    "left_hand_head_height": 4.0,
    "right_hand_head_height": 4.0,
    "guard_height": 3.0,
    "left_elbow_flexion": 2.0,
    "right_elbow_flexion": 2.0,
}


def _clamp(value):
    return max(0.0, min(1.0, value))


def _inside(value, ideal_minimum, ideal_maximum, falloff):
    if ideal_minimum <= value <= ideal_maximum:
        return 1.0
    distance = ideal_minimum - value if value < ideal_minimum else value - ideal_maximum
    return _clamp(1.0 - distance / falloff)


def evaluate_guard_similarity(variables, optimization_context=None):
    """Score non-exempt variables against broad, style-independent guard regions."""
    context = optimization_context or {}
    if context.get("anchor_mode", "none") != "combat_guard":
        return {"version": GUARD_ANCHOR_VERSION, "enabled": False, "score": 1.0, "components": {}}
    exempt = set(context.get("guard_exempt_variables") or [])
    # Combined guard width/height include both wrists. Once either hand is a
    # technique-specific exception, use the remaining per-hand distance rather
    # than allowing that global measurement to penalize the protected hand.
    if exempt & {"left_hand_head_distance", "right_hand_head_distance"}:
        exempt.update({"guard_width", "guard_height"})
    components = {
        variable_id: _inside(variables[variable_id], *target)
        for variable_id, target in GUARD_TARGET_RANGES.items()
        if variable_id not in exempt
    }
    if not components:
        score = 1.0
    else:
        weight_total = sum(GUARD_TARGET_WEIGHTS.get(key, 1.0) for key in components)
        weighted = sum(
            value * GUARD_TARGET_WEIGHTS.get(key, 1.0)
            for key, value in components.items()
        ) / weight_total
        critical_ids = [
            key for key in (
                "left_hand_head_distance", "right_hand_head_distance",
                "left_hand_head_height", "right_hand_head_height", "guard_height",
            ) if key in components
        ]
        critical = sum(components[key] for key in critical_ids) / len(critical_ids) if critical_ids else weighted
        score = 0.55 * weighted + 0.45 * critical
    return {"version": GUARD_ANCHOR_VERSION, "enabled": True, "score": score, "components": components}
