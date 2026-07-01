export default function MetricsPanel({
  steps,
  currentStepIndex,
  accuracy,
  angles,
  requiredParts,
  feedback,
  coachEvent
}) {
  const currentStep = steps[currentStepIndex];
  const focusPart = coachEvent?.focus_body_part || coachEvent?.body_part;
  const activeParts = [...requiredParts].sort((first, second) => {
    if (first.body_part === focusPart) return -1;
    if (second.body_part === focusPart) return 1;
    return 0;
  });

  const formatBodyPart = (bodyPart) =>
    bodyPart
      ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Whole form";

  const getFeedback = (value, min, max) => {
    if (value < min) {
      const diff = Math.round(min - value);
      return `Increase ${diff} deg`;
    }

    if (value > max) {
      const diff = Math.round(value - max);
      return `Decrease ${diff} deg`;
    }

    return "Good";
  };

  return (
    <div className="metrics-panel">
      <div className={`accuracy-card ${accuracy >= 80 ? "is-good" : "is-low"}`}>
        <span>Form Match</span>
        <strong>{accuracy}%</strong>
      </div>

      <div className="panel-block focus-board">
        <p className="eyebrow">Master Focus</p>
        <h2>{formatBodyPart(focusPart)}</h2>
        <p>{coachEvent?.summary || feedback || currentStep?.step_name || "Move into frame."}</p>
      </div>

      <div className="panel-block">
        <div className="panel-heading">
          <p className="eyebrow">Live Values</p>
          <span>{requiredParts.length} tracked</span>
        </div>

        {requiredParts.length === 0 ? (
          <p className="empty-state">No angle targets loaded yet.</p>
        ) : (
          <div className="metrics-grid">
            {activeParts.map((part) => {
              const rawValue = angles?.[part.body_part];
              const hasValue = Number.isFinite(rawValue);
              const value = hasValue ? Math.round(rawValue) : 0;
              const isCorrect = hasValue && value >= part.min && value <= part.max;
              const isFocus = part.body_part === focusPart;

              return (
                <article
                  className={`metric-card ${
                    isCorrect ? "metric-card--good" : "metric-card--bad"
                  } ${isFocus ? "metric-card--focus" : ""}`}
                  key={part.body_part}
                >
                  <span>{formatBodyPart(part.body_part)}</span>
                  <strong>{hasValue ? `${value} deg` : "--"}</strong>
                  <small>
                    Target {part.min}-{part.max} deg
                  </small>
                  <em>{hasValue ? getFeedback(value, part.min, part.max) : "Waiting"}</em>
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
