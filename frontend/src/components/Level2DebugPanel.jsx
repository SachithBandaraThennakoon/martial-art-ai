const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

function formatLabel(value) {
  return value ? value.replace(/_/g, " ") : "--";
}

function MiniProgress({ value = 0, tone = "neutral" }) {
  return (
    <div className={`level2-progress level2-progress--${tone}`}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export default function Level2DebugPanel({ state }) {
  const action = state?.action_context || {};
  const attention = action.attention_prediction || {};
  const mistake = action.likely_mistake;
  const isReady = state?.ready_for_situation_awareness;

  return (
    <div className="level2-panel">
      <div className="panel-heading">
        <p className="eyebrow">Level 2 Action</p>
        <span className={isReady ? "is-good" : "is-low"}>
          {isReady ? "Ready" : "Observing"}
        </span>
      </div>

      <div className="level2-summary">
        <div>
          <span>Step State</span>
          <strong>{formatLabel(action.step_state)}</strong>
        </div>
        <div>
          <span>Trend</span>
          <strong>{formatLabel(action.temporal_trend)}</strong>
        </div>
      </div>

      <div className="level2-bars">
        <div>
          <span>Technique</span>
          <strong>{formatPercent(action.technique_probability)}</strong>
          <MiniProgress value={action.technique_probability} />
        </div>
        <div>
          <span>Step Match</span>
          <strong>{formatPercent(action.step_probability)}</strong>
          <MiniProgress value={action.step_probability} tone="good" />
        </div>
        <div>
          <span>Mistake Risk</span>
          <strong>{formatPercent(action.mistake_risk)}</strong>
          <MiniProgress value={action.mistake_risk} tone="risk" />
        </div>
        <div>
          <span>Prediction</span>
          <strong>{formatPercent(action.prediction_confidence)}</strong>
          <MiniProgress value={action.prediction_confidence} />
        </div>
      </div>

      <div className="level2-mistake">
        <span>Likely Mistake</span>
        <strong>
          {mistake
            ? `${formatLabel(mistake.label)} / ${formatLabel(mistake.issue)}`
            : "No clear mistake"}
        </strong>
        <small>{formatLabel(action.next_step_prediction)}</small>
      </div>

      <div className="level2-attention">
        <span>Future Model</span>
        <strong>{attention.model_name || "ACP-STGAT"}</strong>
        {attention.display_name ? <small>{attention.display_name}</small> : null}
        <small>
          {attention.source ? `${attention.source} / ` : ""}
          {attention.status || "Waiting for action context"}
        </small>
        <small>
          Bone color: {attention.source === "onnx" ? "green" : "orange fallback"}
        </small>
        <small>ONNX status: {attention.onnx_status || "unknown"}</small>
        {attention.onnx_error ? <small>{attention.onnx_error}</small> : null}
        {attention.error ? <small>{attention.error}</small> : null}
        {attention.output_dims?.length ? (
          <small>Output {attention.output_dims.join(" x ")}</small>
        ) : null}
        <div>
          <em>Spatial {attention.spatial_attention?.length || 0}</em>
          <em>Temporal {attention.temporal_attention?.length || 0}</em>
          <em>Graph {attention.graph_attention?.length || 0}</em>
          <em>Cross {attention.cross_attention?.length || 0}</em>
        </div>
      </div>
    </div>
  );
}
