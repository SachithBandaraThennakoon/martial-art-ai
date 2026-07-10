const DEFAULT_CONFIG = {
  updateIntervalMs: 450,
  lowTrackingThreshold: 0.45,
  mistakeRiskThreshold: 0.62,
  fatigueRiskThreshold: 0.62
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function label(value) {
  return value ? String(value).replace(/_/g, " ") : "";
}

function sameMistake(mistake, weakness) {
  if (!mistake || !weakness) return false;
  return (
    mistake.body_part &&
    weakness.body_part &&
    mistake.body_part === weakness.body_part &&
    (!mistake.issue || !weakness.issue || mistake.issue === weakness.issue)
  );
}

function getAttentionTarget({ trackingConfidence, action, session, user, weaknessMatch, config }) {
  if (trackingConfidence < config.lowTrackingThreshold) {
    return {
      layer: "level1",
      body_part: "camera",
      issue: "tracking_low",
      priority: round(1 - trackingConfidence)
    };
  }

  if (weaknessMatch && user.top_weakness) {
    return {
      layer: "level4",
      body_part: user.top_weakness.body_part,
      issue: user.top_weakness.issue,
      priority: round((action.mistake_risk || 0) * 0.55 + 0.35)
    };
  }

  if (action.likely_mistake?.body_part) {
    return {
      layer: "level2",
      body_part: action.likely_mistake.body_part,
      issue: action.likely_mistake.issue || "technique_error",
      priority: round(action.mistake_risk || 0)
    };
  }

  if ((session.fatigue_risk || 0) >= config.fatigueRiskThreshold) {
    return {
      layer: "level3",
      body_part: "whole_body",
      issue: "fatigue_risk",
      priority: round(session.fatigue_risk)
    };
  }

  return {
    layer: "level3",
    body_part: "whole_form",
    issue: session.recommendation || "continue",
    priority: round(session.mastery_score || 0)
  };
}

function getSituationState({ trackingConfidence, action, session, userProgression, config }) {
  if (trackingConfidence < config.lowTrackingThreshold) return "tracking_unclear";
  if ((action.mistake_risk || 0) >= config.mistakeRiskThreshold) return "correcting";
  if ((session.fatigue_risk || 0) >= config.fatigueRiskThreshold) return "warning";
  if (userProgression.ready_for_next_technique || session.recommendation === "advance_step") {
    return "advance_ready";
  }
  if ((session.mastery_score || 0) >= 0.58 && (session.trend || "") === "improving") {
    return "encouraging";
  }
  return "observing";
}

function getFeedbackDecision({ situationState, attentionTarget, session, user }) {
  const intensity = user.personalization?.coaching_intensity || "medium";

  if (situationState === "tracking_unclear") {
    return {
      type: "tracking_prompt",
      timing: "immediate",
      intensity: "low",
      message: "Tracking is unclear. Move fully into camera view.",
      should_speak: true,
      should_show_text: true,
      should_pause_progression: true
    };
  }

  if (situationState === "warning") {
    return {
      type: "fatigue_warning",
      timing: "immediate",
      intensity: "medium",
      message: "Form quality is dropping. Slow down and reset before continuing.",
      should_speak: true,
      should_show_text: true,
      should_pause_progression: true
    };
  }

  if (situationState === "correcting") {
    const part = label(attentionTarget.body_part);
    const issue = label(attentionTarget.issue);
    const personalized = attentionTarget.layer === "level4";

    return {
      type: personalized ? "personalized_correction" : "correction",
      timing: "immediate",
      intensity,
      message: personalized
        ? `${part} is repeating your known pattern: ${issue}. Slow down and fix it now.`
        : `${part} needs correction: ${issue}. Hold this step and clean the form.`,
      should_speak: true,
      should_show_text: true,
      should_pause_progression: true
    };
  }

  if (situationState === "advance_ready") {
    return {
      type: "advance",
      timing: "after_current_rep",
      intensity: "low",
      message: "Good consistency. You are ready to advance.",
      should_speak: true,
      should_show_text: true,
      should_pause_progression: false
    };
  }

  if (situationState === "encouraging") {
    return {
      type: "encouragement",
      timing: "delayed",
      intensity: "low",
      message: "Good trend. Keep the same rhythm and repeat cleanly.",
      should_speak: false,
      should_show_text: true,
      should_pause_progression: false
    };
  }

  return {
    type: "observe",
    timing: "none",
    intensity: "low",
    message: session.coach_message || "Observing movement context.",
    should_speak: false,
    should_show_text: false,
    should_pause_progression: false
  };
}

function getNextAction({ situationState, attentionTarget, userProgression }) {
  if (situationState === "tracking_unclear") {
    return {
      command: "fix_tracking",
      step_focus: "camera_position",
      allow_next_step: false,
      agent_intent: "ask_user_to_reposition"
    };
  }

  if (situationState === "warning") {
    return {
      command: "slow_down",
      step_focus: "fatigue_reset",
      allow_next_step: false,
      agent_intent: "reduce_intensity"
    };
  }

  if (situationState === "correcting") {
    return {
      command: "repeat_step",
      step_focus: `${attentionTarget.body_part}_${attentionTarget.issue}`,
      allow_next_step: false,
      agent_intent: "give_targeted_correction"
    };
  }

  if (situationState === "advance_ready") {
    return {
      command: userProgression.ready_for_next_technique ? "unlock_next_technique" : "advance_step",
      step_focus: "next_progression",
      allow_next_step: true,
      agent_intent: "advance_training_plan"
    };
  }

  return {
    command: "continue",
    step_focus: "current_form",
    allow_next_step: false,
    agent_intent: "observe"
  };
}

export class SituationAwarenessLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastUpdateMs = 0;
    this.latestState = null;
  }

  update({ level1State, level2State, level3State, level4State, mode = "train" }) {
    const action = level2State?.action_context;
    const session = level3State?.session_context;
    const user = level4State?.user_context;
    if (!level1State || !action || !session || !user) return this.latestState;

    const timestampMs = (level1State.timestamp || Date.now() / 1000) * 1000;
    if (timestampMs - this.lastUpdateMs < this.config.updateIntervalMs) {
      return this.latestState;
    }

    this.lastUpdateMs = timestampMs;

    const trackingConfidence = level1State.tracking?.confidence || 0;
    const userProgression = user.progression || {};
    const weaknessMatch = sameMistake(action.likely_mistake, user.top_weakness);
    const attentionTarget = getAttentionTarget({
      trackingConfidence,
      action,
      session,
      user,
      weaknessMatch,
      config: this.config
    });
    const situationState = getSituationState({
      trackingConfidence,
      action,
      session,
      userProgression,
      config: this.config
    });
    const feedbackDecision = getFeedbackDecision({
      situationState,
      attentionTarget,
      session,
      user
    });
    const trackingRisk = 1 - trackingConfidence;
    const decisionScore = clamp(
      (action.mistake_risk || 0) * 0.35 +
        (session.fatigue_risk || 0) * 0.25 +
        (weaknessMatch ? 0.2 : 0) +
        trackingRisk * 0.2,
      0,
      1
    );
    const nextAction = getNextAction({
      situationState,
      attentionTarget,
      userProgression
    });

    this.latestState = {
      timestamp: level1State.timestamp,
      situation_context: {
        mode,
        situation_state: situationState,
        attention_target: attentionTarget,
        feedback_decision: feedbackDecision,
        reasoning: {
          motion_confidence: round(trackingConfidence),
          mistake_risk: round(action.mistake_risk || 0),
          fatigue_risk: round(session.fatigue_risk || 0),
          user_history_match: Boolean(weaknessMatch),
          decision_score: round(decisionScore)
        },
        next_action: nextAction,
        agent_context: {
          state: situationState,
          priority: round(Math.max(decisionScore, attentionTarget.priority || 0)),
          target: attentionTarget.body_part,
          issue: attentionTarget.issue,
          action: nextAction.command,
          message: feedbackDecision.message
        }
      },
      debug: {
        input_layers_ready: {
          level1: Boolean(level1State),
          level2: Boolean(action),
          level3: Boolean(session),
          level4: Boolean(user)
        }
      }
    };

    return this.latestState;
  }
}
