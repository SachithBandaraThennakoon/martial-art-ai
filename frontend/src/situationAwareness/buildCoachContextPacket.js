import { TEMPORAL_LAYER_KNOWLEDGE } from "./temporalLayerKnowledge";

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function compactMistake(mistake) {
  if (!mistake) return null;
  return {
    body_part: mistake.body_part || mistake.label || null,
    issue: mistake.issue || null,
    count: mistake.count || undefined
  };
}

function compactLevel1(level1State) {
  const motion = level1State?.motion_context || {};
  return {
    time_horizon: TEMPORAL_LAYER_KNOWLEDGE.level1_motion.prediction_horizon,
    tracking_confidence: round(level1State?.tracking?.confidence),
    fps: level1State?.tracking?.fps || 0,
    prediction_confidence: round(motion.prediction_confidence),
    prediction_horizon_ms: motion.prediction_horizon_ms || 0,
    angles_count: Object.keys(motion.angles_deg || {}).length
  };
}

function compactLevel2(level2State) {
  const action = level2State?.action_context || {};
  return {
    time_horizon: TEMPORAL_LAYER_KNOWLEDGE.level2_action.prediction_horizon,
    step_state: action.step_state || null,
    step_probability: round(action.step_probability),
    mistake_risk: round(action.mistake_risk),
    temporal_trend: action.temporal_trend || null,
    likely_mistake: compactMistake(action.likely_mistake),
    next_step_prediction: action.next_step_prediction || null
  };
}

function compactLevel3(level3State) {
  const session = level3State?.session_context || {};
  return {
    time_horizon: TEMPORAL_LAYER_KNOWLEDGE.level3_session.prediction_horizon,
    session_state: session.session_state || null,
    mastery_score: round(session.mastery_score),
    consistency_score: round(session.consistency_score),
    fatigue_risk: round(session.fatigue_risk),
    trend: session.trend || null,
    repeated_mistake: compactMistake(session.repeated_mistake),
    recommendation: session.recommendation || null,
    ready_for_level_4: Boolean(session.ready_for_level_4)
  };
}

function compactLevel4(level4State) {
  const user = level4State?.user_context || {};
  const activeTechnique = user.active_technique || {};
  return {
    time_horizon: TEMPORAL_LAYER_KNOWLEDGE.level4_user.prediction_horizon,
    user_id: user.user_id || "local_user",
    user_level: user.user_level || "beginner",
    total_samples: user.total_samples || 0,
    active_technique: {
      technique_key: activeTechnique.technique_key || null,
      mastery_score: round(activeTechnique.mastery_score),
      best_mastery_score: round(activeTechnique.best_mastery_score),
      consistency_score: round(activeTechnique.consistency_score),
      learning_trend: activeTechnique.learning_trend || null
    },
    top_weakness: compactMistake(user.top_weakness),
    personalization: user.personalization || {},
    progression: user.progression || {}
  };
}

function compactSituation(situationAwarenessState) {
  const situation = situationAwarenessState?.situation_context || {};
  return {
    time_horizon: TEMPORAL_LAYER_KNOWLEDGE.situation_awareness.prediction_horizon,
    situation_state: situation.situation_state || null,
    attention_target: situation.attention_target || {},
    feedback_decision: situation.feedback_decision || {},
    reasoning: situation.reasoning || {},
    next_action: situation.next_action || {},
    agent_context: situation.agent_context || {}
  };
}

export function buildCoachContextPacket({
  level1State,
  level2State,
  level3State,
  level4State,
  situationAwarenessState,
  mode,
  techniqueName,
  currentStepId,
  currentStepName
}) {
  if (!level1State || !level2State || !level3State || !level4State || !situationAwarenessState) {
    return null;
  }

  return {
    type: "coach_intelligence_context",
    timestamp: level1State.timestamp || Date.now() / 1000,
    mode: mode || "train",
    technique: techniqueName || null,
    current_step: {
      id: currentStepId ?? null,
      name: currentStepName ?? null
    },
    temporal_knowledge_version: "temporal_intelligence_v1",
    temporal_layers: {
      level1_motion: compactLevel1(level1State),
      level2_action: compactLevel2(level2State),
      level3_session: compactLevel3(level3State),
      level4_user: compactLevel4(level4State)
    },
    situation_awareness: compactSituation(situationAwarenessState)
  };
}
