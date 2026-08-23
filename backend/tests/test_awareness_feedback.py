from awareness.feedback import build_feedback_frame, render_feedback


def _frame():
    return build_feedback_frame(
        mode="step",
        goal={"type": "improve_user_technique", "technique": "Jab"},
        awareness={
            "situation_state": "correcting",
            "likely_mistake": {"issue": "rear_hand_guard", "correction": "Raise the rear hand."},
            "difference_vector": {"rear_hand_guard": 0.24},
        },
        feedback_type="technique_correction",
        message="Hold this step and raise the rear hand.",
        priority=0.9,
        confidence=0.8,
        forecast_risks=[],
    )


def test_feedback_frame_is_structured_and_deterministic():
    frame = _frame()
    result = render_feedback(frame)

    assert frame["schema_version"] == "feedback/v2"
    assert frame["mode"] == "step"
    assert frame["strategy"] == "framework"
    assert frame["numerical_difference"]["rear_hand_guard"] == 0.24
    assert frame["teaching_policy"]["llm_used"] is False
    assert result == {
        "message": "Raise the rear hand. This keeps the movement connected.",
        "renderer": "deterministic-teaching-framework",
        "fallback": False,
    }


def test_safety_feedback_frame_is_marked_locked():
    frame = build_feedback_frame(
        mode="live",
        goal={"type": "detect_threat"},
        awareness={"situation_state": "hazard_detected"},
        feedback_type="safety",
        message="Pause now.",
        priority=1,
        confidence=1,
        forecast_risks=[],
    )

    assert frame["safety_locked"] is True


def test_agent_strategy_is_still_local_and_deterministic():
    frame = build_feedback_frame(
        mode="live",
        goal={"type": "improve_user_technique", "feedback_strategy": "agent"},
        awareness={},
        feedback_type="none",
        message="Continue.",
        priority=0.2,
        confidence=0.7,
        forecast_risks=[],
    )

    assert frame["strategy"] == "agent"
    assert render_feedback(frame)["renderer"] == "deterministic"


def test_framework_renders_body_specific_cue_and_reason():
    frame = build_feedback_frame(
        mode="live",
        goal={"type": "improve_user_technique", "feedback_strategy": "framework"},
        awareness={
            "situation_state": "correcting",
            "likely_mistake": {
                "body_part": "knee_left",
                "issue": "too_open",
                "error": 24,
            },
        },
        feedback_type="technique_correction",
        message="Hold this step and correct the highest-priority supported issue.",
        priority=.9,
        confidence=.8,
        forecast_risks=[],
    )

    assert render_feedback(frame)["message"] == (
        "Bend your lead knee slightly more. This gives you a stable base."
    )
