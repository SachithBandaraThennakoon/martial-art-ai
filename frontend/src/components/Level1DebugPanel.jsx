const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

const formatError = (value) =>
  Number.isFinite(value) ? value.toFixed(3) : "--";

const formatAngle = (value) =>
  Number.isFinite(value) ? `${Math.round(value)} deg` : "--";

function MiniTrend({ values = [], label }) {
  const chartValues = values.slice(-36);
  const maxValue = Math.max(...chartValues.filter(Number.isFinite), 0.001);

  return (
    <div className="level1-trend" aria-label={label}>
      {chartValues.map((value, index) => (
        <i
          key={`${label}-${index}`}
          style={{
            height: `${Math.max(8, Math.min(100, (value / maxValue) * 100))}%`
          }}
        />
      ))}
    </div>
  );
}

export default function Level1DebugPanel({ state }) {
  const metrics = state?.debug?.metrics || {};
  const motion = state?.motion_context || {};
  const tracking = state?.tracking || {};
  const history = state?.debug?.metricsHistory || [];
  const positionValues = history.map((entry) => entry.averageJointPositionError);
  const angleValues = history.map((entry) => entry.averageAngleError).filter(Number.isFinite);

  return (
    <div className="level1-panel">
      <div className="panel-heading">
        <p className="eyebrow">Level 1 Motion</p>
        <span className={state?.ready_for_next_layer ? "is-good" : "is-low"}>
          {state?.ready_for_next_layer ? "Ready" : "Warming"}
        </span>
      </div>

      <div className="level1-grid">
        <div>
          <span>FPS</span>
          <strong>{tracking.fps || "--"}</strong>
        </div>
        <div>
          <span>Tracking</span>
          <strong>{formatPercent(tracking.confidence)}</strong>
        </div>
        <div>
          <span>Prediction</span>
          <strong>{formatPercent(motion.prediction_confidence)}</strong>
        </div>
        <div>
          <span>Frames</span>
          <strong>{tracking.frame_count || 0}</strong>
        </div>
      </div>

      <div className="level1-metrics">
        <div>
          <span>Position error</span>
          <strong>{formatError(metrics.averageJointPositionError)}</strong>
        </div>
        <div>
          <span>Angle error</span>
          <strong>{formatAngle(metrics.averageAngleError)}</strong>
        </div>
        <div>
          <span>Wrist</span>
          <strong>{formatError(metrics.wristError)}</strong>
        </div>
        <div>
          <span>Elbow</span>
          <strong>{formatError(metrics.elbowError)}</strong>
        </div>
        <div>
          <span>Knee</span>
          <strong>{formatError(metrics.kneeError)}</strong>
        </div>
      </div>

      <div className="level1-charts">
        <div>
          <span>Prediction error</span>
          <MiniTrend label="Position error trend" values={positionValues} />
        </div>
        <div>
          <span>Angle error</span>
          <MiniTrend label="Angle error trend" values={angleValues} />
        </div>
      </div>
    </div>
  );
}
