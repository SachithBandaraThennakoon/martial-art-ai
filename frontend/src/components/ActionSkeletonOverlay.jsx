const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

const formatLabel = (value) => (value ? value.replace(/_/g, " ") : "--");

export default function ActionSkeletonOverlay({ level2State, variant = "overlay" }) {
  const action = level2State?.action_context;

  if (!action) return null;

  const mistake = action.likely_mistake;
  const attention = action.attention_prediction || {};
  const onnxError = attention.onnx_error || attention.error;

  return (
    <div
      className={`action-skeleton-overlay action-skeleton-overlay--${variant}`}
      aria-label="Live action analysis"
    >
      <div className="action-skeleton-overlay__status">
        <span>Level 2 Action</span>
        <strong>{formatLabel(action.step_state)}</strong>
      </div>

      <div className="action-skeleton-overlay__grid">
        <div>
          <span>Step Match</span>
          <strong>{formatPercent(action.step_probability)}</strong>
        </div>
        <div>
          <span>Mistake Risk</span>
          <strong>{formatPercent(action.mistake_risk)}</strong>
        </div>
      </div>

      <div className="action-skeleton-overlay__mistake">
        <span>{mistake ? formatLabel(mistake.label) : "No clear mistake"}</span>
        <strong>{mistake ? formatLabel(mistake.issue) : formatLabel(action.next_step_prediction)}</strong>
      </div>

      <div className="action-skeleton-overlay__model">
        <span>ACP-STGAT</span>
        <strong>
          {attention.source === "onnx"
            ? `ONNX green / ${formatLabel(attention.status)}`
            : `Orange / ${formatLabel(attention.onnx_status || attention.status)}`}
        </strong>
        {onnxError ? <small title={onnxError}>{onnxError}</small> : null}
      </div>
    </div>
  );
}
