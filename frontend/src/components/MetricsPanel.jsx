export default function MetricsPanel({
  steps,
  currentStepIndex,
  accuracy,
  angles,
  requiredParts,
  feedback
}) {
  const currentStep = steps[currentStepIndex];

  const getFeedback = (value, min, max) => {
    if (value < min) {
      const diff = min - value;
      return diff > 40 ? "Extend more" : "Slightly more";
    }

    if (value > max) {
      return "Reduce angle";
    }

    return "Good";
  };

  return (
    <div className="metrics-panel">
      <div className={`accuracy-card ${accuracy >= 80 ? "is-good" : "is-low"}`}>
        <span>Accuracy</span>
        <strong>{accuracy}%</strong>
      </div>

      <div className="panel-block">
        <p className="eyebrow">Current Step</p>
        <h2>{currentStep?.step_name || "No step selected"}</h2>
      </div>

      <div className="panel-block">
        <div className="panel-heading">
          <p className="eyebrow">Angles</p>
          <span>{requiredParts.length} tracked</span>
        </div>

        {requiredParts.length === 0 ? (
          <p className="empty-state">No angle targets loaded yet.</p>
        ) : (
          <div className="metrics-grid">
            {requiredParts.map((part) => {
              const rawValue = angles?.[part.body_part];
              const value = rawValue ? Math.round(rawValue) : 0;
              const isCorrect = value >= part.min && value <= part.max;

              return (
                <article
                  className={`metric-card ${
                    isCorrect ? "metric-card--good" : "metric-card--bad"
                  }`}
                  key={part.body_part}
                >
                  <span>{part.body_part.replace("_", " ")}</span>
                  <strong>{value} deg</strong>
                  <small>
                    Target {part.min}-{part.max} deg
                  </small>
                  <em>{getFeedback(value, part.min, part.max)}</em>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel-block coach-card">
        <p className="eyebrow">Coach Feedback</p>
        <p className="coach-feedback">
          {feedback || "Move into frame and begin the selected step."}
        </p>
      </div>
    </div>
  );
}
