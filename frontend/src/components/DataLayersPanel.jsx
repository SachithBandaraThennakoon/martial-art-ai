const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

const formatDecimal = (value) =>
  Number.isFinite(value) ? value.toFixed(3) : "--";

const formatLabel = (value) => (value ? String(value).replace(/_/g, " ") : "--");

function SchemaRows({ rows }) {
  return (
    <dl className="data-schema">
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.key}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LayerCard({ number, title, status, schema = [] }) {
  return (
    <div className="data-layer-card">
      <div className="data-layer-card__heading">
        <span>{number}</span>
        <b>{title}</b>
        <strong>{formatLabel(status)}</strong>
      </div>
      <SchemaRows rows={schema} />
    </div>
  );
}

export default function DataLayersPanel({
  level1State,
  level2State,
  level3State,
  level4State,
  situationAwarenessState
}) {
  const motion = level1State?.motion_context || {};
  const action = level2State?.action_context || {};
  const session = level3State?.session_context || {};
  const repeatedMistake = session.repeated_mistake;
  const user = level4State?.user_context || {};
  const activeTechnique = user.active_technique || {};
  const topWeakness = user.top_weakness || {};
  const personalization = user.personalization || {};
  const progression = user.progression || {};
  const situation = situationAwarenessState?.situation_context || {};
  const attentionTarget = situation.attention_target || {};
  const feedbackDecision = situation.feedback_decision || {};
  const reasoning = situation.reasoning || {};
  const nextAction = situation.next_action || {};
  const agentContext = situation.agent_context || {};

  return (
    <div className="data-layers-panel">
      <LayerCard
        number="01"
        title="Level 1 Motion"
        status={level1State?.ready_for_next_layer ? "ready" : "collecting"}
        schema={[
          {
            key: "ready_for_next_layer",
            value: String(Boolean(level1State?.ready_for_next_layer))
          },
          {
            key: "tracking.confidence",
            value: `${formatDecimal(level1State?.tracking?.confidence)} (${formatPercent(level1State?.tracking?.confidence)})`
          },
          { key: "tracking.fps", value: level1State?.tracking?.fps || "--" },
          {
            key: "motion_context.prediction_confidence",
            value: `${formatDecimal(motion.prediction_confidence)} (${formatPercent(motion.prediction_confidence)})`
          },
          { key: "motion_context.prediction_horizon_ms", value: motion.prediction_horizon_ms || "--" },
          { key: "angles_count", value: Object.keys(motion.angles_deg || {}).length }
        ]}
      />

      <LayerCard
        number="02"
        title="Level 2 Action"
        status={action.step_state || "waiting"}
        schema={[
          { key: "step_state", value: formatLabel(action.step_state) },
          {
            key: "step_probability",
            value: `${formatDecimal(action.step_probability)} (${formatPercent(action.step_probability)})`
          },
          {
            key: "mistake_risk",
            value: `${formatDecimal(action.mistake_risk)} (${formatPercent(action.mistake_risk)})`
          },
          { key: "temporal_trend", value: formatLabel(action.temporal_trend) },
          { key: "likely_mistake.body_part", value: formatLabel(action.likely_mistake?.body_part) },
          { key: "likely_mistake.issue", value: formatLabel(action.likely_mistake?.issue) },
          { key: "next_step_prediction", value: formatLabel(action.next_step_prediction) }
        ]}
      />

      <LayerCard
        number="03"
        title="Level 3 Session"
        status={session.session_state || "warming_up"}
        schema={[
          { key: "session_state", value: formatLabel(session.session_state) },
          {
            key: "mastery_score",
            value: `${formatDecimal(session.mastery_score)} (${formatPercent(session.mastery_score)})`
          },
          {
            key: "consistency_score",
            value: `${formatDecimal(session.consistency_score)} (${formatPercent(session.consistency_score)})`
          },
          {
            key: "fatigue_risk",
            value: `${formatDecimal(session.fatigue_risk)} (${formatPercent(session.fatigue_risk)})`
          },
          { key: "recommendation", value: formatLabel(session.recommendation) },
          { key: "repeated_mistake.body_part", value: formatLabel(repeatedMistake?.body_part) },
          { key: "ready_for_level_4", value: String(Boolean(session.ready_for_level_4)) }
        ]}
      />

      <LayerCard
        number="04"
        title="Level 4 User"
        status={progression.recommendation || "collecting"}
        schema={[
          { key: "user_id", value: user.user_id || "local_user" },
          { key: "user_level", value: formatLabel(user.user_level || "beginner") },
          { key: "training_age_days", value: user.training_age_days ?? 0 },
          { key: "total_samples", value: user.total_samples || 0 },
          { key: "total_sessions_observed", value: user.total_sessions_observed || 0 },
          { key: "active_technique.technique_key", value: activeTechnique.technique_key || "--" },
          {
            key: "active_technique.mastery_score",
            value: `${formatDecimal(activeTechnique.mastery_score)} (${formatPercent(activeTechnique.mastery_score)})`
          },
          {
            key: "active_technique.best_mastery_score",
            value: `${formatDecimal(activeTechnique.best_mastery_score)} (${formatPercent(activeTechnique.best_mastery_score)})`
          },
          {
            key: "active_technique.consistency_score",
            value: `${formatDecimal(activeTechnique.consistency_score)} (${formatPercent(activeTechnique.consistency_score)})`
          },
          { key: "active_technique.learning_trend", value: formatLabel(activeTechnique.learning_trend) },
          { key: "top_weakness.body_part", value: formatLabel(topWeakness.body_part) },
          { key: "top_weakness.issue", value: formatLabel(topWeakness.issue) },
          { key: "top_weakness.count", value: topWeakness.count || 0 },
          { key: "personalization.coaching_intensity", value: formatLabel(personalization.coaching_intensity) },
          { key: "personalization.recommended_speed", value: formatLabel(personalization.recommended_speed) },
          { key: "personalization.next_focus", value: formatLabel(personalization.next_focus) },
          { key: "progression.recommendation", value: formatLabel(progression.recommendation) },
          {
            key: "progression.ready_for_next_technique",
            value: String(Boolean(progression.ready_for_next_technique))
          },
          { key: "progression.ready_for_level_5", value: String(Boolean(progression.ready_for_level_5)) }
        ]}
      />

      <LayerCard
        number="05"
        title="Situation Awareness"
        status={situation.situation_state || "waiting"}
        schema={[
          { key: "mode", value: formatLabel(situation.mode) },
          { key: "situation_state", value: formatLabel(situation.situation_state) },
          { key: "attention_target.layer", value: formatLabel(attentionTarget.layer) },
          { key: "attention_target.body_part", value: formatLabel(attentionTarget.body_part) },
          { key: "attention_target.issue", value: formatLabel(attentionTarget.issue) },
          {
            key: "attention_target.priority",
            value: `${formatDecimal(attentionTarget.priority)} (${formatPercent(attentionTarget.priority)})`
          },
          { key: "feedback_decision.type", value: formatLabel(feedbackDecision.type) },
          { key: "feedback_decision.timing", value: formatLabel(feedbackDecision.timing) },
          { key: "feedback_decision.intensity", value: formatLabel(feedbackDecision.intensity) },
          { key: "feedback_decision.should_speak", value: String(Boolean(feedbackDecision.should_speak)) },
          {
            key: "feedback_decision.should_pause_progression",
            value: String(Boolean(feedbackDecision.should_pause_progression))
          },
          {
            key: "reasoning.decision_score",
            value: `${formatDecimal(reasoning.decision_score)} (${formatPercent(reasoning.decision_score)})`
          },
          { key: "reasoning.user_history_match", value: String(Boolean(reasoning.user_history_match)) },
          { key: "next_action.command", value: formatLabel(nextAction.command) },
          { key: "next_action.step_focus", value: formatLabel(nextAction.step_focus) },
          { key: "next_action.allow_next_step", value: String(Boolean(nextAction.allow_next_step)) }
        ]}
      />

      <div className="data-layer-recommendation">
        <SchemaRows
          rows={[
            { key: "level3.recommendation", value: formatLabel(session.recommendation || "continue") },
            { key: "level3.coach_message", value: session.coach_message || "Waiting for enough session history." },
            { key: "level3.samples", value: level3State?.debug?.samples || 0 },
            { key: "level3.avg_tracking", value: formatDecimal(level3State?.debug?.average_tracking) },
            {
              key: "level4.progression.coach_message",
              value: progression.coach_message || "Waiting for enough user history."
            },
            { key: "level4.debug.stored_techniques", value: level4State?.debug?.stored_techniques || 0 },
            { key: "level4.debug.stored_weaknesses", value: level4State?.debug?.stored_weaknesses || 0 },
            {
              key: "situation_awareness.feedback_decision.message",
              value: feedbackDecision.message || "Waiting for full temporal context."
            },
            { key: "situation_awareness.agent_context.action", value: formatLabel(agentContext.action) },
            { key: "situation_awareness.agent_context.priority", value: formatDecimal(agentContext.priority) }
          ]}
        />
      </div>
    </div>
  );
}
