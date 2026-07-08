export const TEMPORAL_LAYER_KNOWLEDGE = {
  level1_motion: {
    name: "Level 1 Motion",
    time_scale: "current_frame_to_short_horizon",
    prediction_horizon: "t+100ms_to_t+300ms",
    meaning: "Raw pose quality, joint angles, velocity, acceleration, and short motion prediction.",
    agent_use: "Use for body mechanics, tracking confidence, and immediate motion quality.",
    trust_rule: "Do not over-correct technique when tracking confidence is low."
  },
  level2_action: {
    name: "Level 2 Action",
    time_scale: "current_step_to_action_horizon",
    prediction_horizon: "about_t+1s",
    meaning: "Current technique step, action prediction, likely mistake, and mistake risk.",
    agent_use: "Use for immediate step correction and repeat/continue decisions.",
    trust_rule: "Prefer this for technique errors only when Level 1 tracking is stable."
  },
  level3_session: {
    name: "Level 3 Session",
    time_scale: "current_training_session",
    prediction_horizon: "next_reps_to_minutes",
    meaning: "Session mastery, consistency, fatigue risk, trend, and repeated mistakes.",
    agent_use: "Use for pacing, fatigue warnings, repetition strategy, and advance readiness.",
    trust_rule: "Use as session trend, not single-frame truth."
  },
  level4_user: {
    name: "Level 4 User",
    time_scale: "long_term_user_history",
    prediction_horizon: "future_sessions",
    meaning: "User level, long-term weakness memory, personalization, and progression readiness.",
    agent_use: "Use for personalized coaching intensity, next focus, and long-term plan.",
    trust_rule: "Use only as personalization context; current situation still comes from live layers."
  },
  situation_awareness: {
    name: "Situation Awareness",
    time_scale: "decision_moment",
    prediction_horizon: "now_to_next_feedback_window",
    meaning: "Combines temporal layers into a feedback decision, attention target, and agent intent.",
    agent_use: "Use as the primary decision signal for whether to speak, pause, repeat, or advance.",
    trust_rule: "If the decision score is low, observe instead of interrupting."
  }
};
