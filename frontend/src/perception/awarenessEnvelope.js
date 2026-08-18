const confidence = (value) => Math.max(0, Math.min(1, Number(value || 0)));

export function buildAwarenessPerceptionEnvelope({
  diagnostics,
  goalType = "improve_user_technique",
  metadata = {},
  mode = "training",
  sequence,
  sessionKey,
  techniqueName
}) {
  const level1 = diagnostics?.level1State || {};
  const action = diagnostics?.level2State?.action_context || {};
  const session = diagnostics?.level3State?.session_context || {};
  const user = diagnostics?.level4State?.user_context || {};
  const situation = diagnostics?.situationAwarenessState?.situation_context || {};
  const perception = diagnostics?.perceptionObservation || {};

  return {
    schema_version: "perception/v1",
    session_key: sessionKey,
    sequence,
    captured_at: new Date().toISOString(),
    goal: { type: goalType, technique: techniqueName, mode },
    human: {
      observation_id: "user:primary",
      confidence: confidence(level1.tracking?.confidence),
      bbox: perception.human?.bbox || null,
      position: perception.human?.position || null,
      l1: {
        tracking: level1.tracking || {},
        angles_deg: level1.motion_context?.angles_deg || {},
        prediction_confidence: level1.motion_context?.prediction_confidence ?? null,
        motion_energy: level1.motion_context?.motion_energy ?? null
      },
      l2: action,
      l3: session,
      l4: user
    },
    objects: [],
    surfaces: perception.surfaces || [],
    geometry: perception.geometry || null,
    metadata: {
      ...metadata,
      technique: techniqueName,
      step: action.step_id || null,
      scene_diagnostics: perception.diagnostics || {},
      client_awareness: {
        situation_state: situation.situation_state || "observing",
        feedback_decision: situation.feedback_decision || {},
        next_action: situation.next_action || {},
        attention: situation.attention_target || {},
        prediction: action.forecast_awareness || {},
        reasoning: situation.reasoning || {}
      }
    }
  };
}
