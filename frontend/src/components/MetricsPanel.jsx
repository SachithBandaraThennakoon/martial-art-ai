export default function MetricsPanel({
  steps,
  currentStepIndex,
  accuracy,
  angles,
  requiredParts,
  feedback,
  coachEvent,
  compositeForm,
  difficulty = "medium",
  onDifficultyChange
}) {
  const currentStep = steps[currentStepIndex];
  const topCompositeCorrection = compositeForm?.corrections?.[0];
  const topCompositeStrength = compositeForm?.strengths?.[0];
  const focusPart =
    ["angle", "quality"].includes(topCompositeCorrection?.kind)
      ? topCompositeCorrection.bodyPart
      : topCompositeStrength?.bodyPart ||
        coachEvent?.focus_body_part ||
        coachEvent?.body_part;
  const isReadinessMetric = (bodyPart) =>
    bodyPart?.startsWith("fist_") ||
    bodyPart?.startsWith("hand_") ||
    bodyPart?.startsWith("face_") ||
    bodyPart?.startsWith("eyes_");
  const bodyParts = requiredParts.filter(
    (part) => !isReadinessMetric(part.body_part)
  );
  const activeParts = [...bodyParts].sort((first, second) => {
    if (first.body_part === focusPart) return -1;
    if (second.body_part === focusPart) return 1;
    return 0;
  });

  const formatBodyPart = (bodyPart) =>
    bodyPart
      ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Whole form";

  const formatValue = (value) => `${value} deg`;

  const formatTarget = (target, min, max) =>
    `Ideal ${target ?? Math.round((min + max) / 2)}° · Range ${min}-${max}°`;

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
  const compositeCorrectionText = topCompositeCorrection
    ? topCompositeCorrection.kind === "angle"
      ? `${topCompositeCorrection.label}: ${topCompositeCorrection.current}°, ideal ${topCompositeCorrection.ideal}°.`
      : `${topCompositeCorrection.label}. Adjust the movement quality and repeat smoothly.`
    : topCompositeStrength
      ? `${topCompositeStrength.label} is correct at ${topCompositeStrength.current}${topCompositeStrength.kind === "angle" ? "°" : "%"}, close to the ${topCompositeStrength.ideal}${topCompositeStrength.kind === "angle" ? "°" : "%"} ideal.`
      : null;

  return (
    <div className="metrics-panel">
      <div className={`accuracy-card ${accuracy >= 80 ? "is-good" : "is-low"}`}>
        <div className="accuracy-card__summary">
          <span>Weighted Form Match</span>
          <strong>{compositeForm?.scorable ? `${accuracy}%` : "--"}</strong>
          <small>{compositeForm?.coverage ?? 0}% evidence coverage</small>
        </div>
        <div className="form-difficulty" aria-label="Correction difficulty">
          {["easy", "medium", "hard"].map((option) => (
            <button
              aria-pressed={difficulty === option}
              className={difficulty === option ? "is-active" : ""}
              key={option}
              onClick={() => onDifficultyChange?.(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-block focus-board">
        <p className="eyebrow">Master Focus</p>
        <h2>{formatBodyPart(focusPart)}</h2>
        <p>
          {compositeCorrectionText ||
            coachEvent?.summary ||
            feedback ||
            currentStep?.step_name ||
            "Move into frame."}
        </p>
      </div>

      {compositeForm ? (
        <div className="panel-block form-score-details">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Correction priority</p>
              <small>Highest-impact changes first</small>
            </div>
          </div>
          <div className="form-score-groups">
            {[
              ["Punch", compositeForm.groupScores.primary],
              ["Balance", compositeForm.groupScores.balance],
              ["Power", compositeForm.groupScores.power],
              ["Alignment", compositeForm.groupScores.alignment],
              ["Hands", compositeForm.groupScores.guard],
              ["Focus", compositeForm.groupScores.focus],
              ["Motion", compositeForm.groupScores.motion]
            ].map(([label, score]) => (
              <span key={label}>
                <small>{label}</small>
                <strong>{Number.isFinite(score) ? `${score}%` : "--"}</strong>
              </span>
            ))}
          </div>
          {compositeForm.corrections.length ? (
            <ol className="form-correction-list">
              {compositeForm.corrections.map((correction) => (
                <li key={correction.bodyPart}>
                  <strong>{correction.label}</strong>
                  {correction.kind === "angle" ? (
                    <small>
                      Current {correction.current}° · Ideal {correction.ideal}° ·
                      Range {correction.min}-{correction.max}°
                    </small>
                  ) : correction.kind === "quality" ? (
                    <small>
                      Current {correction.current}% · Ideal {correction.ideal}% ·
                      Range {correction.min}-{correction.max}%
                    </small>
                  ) : (
                    <small>Motion evidence needs adjustment</small>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="form-correction-clear">
              {compositeForm.scorable
                ? "No major correction in the visible evidence."
                : "Show more of your body before form is scored."}
            </p>
          )}
          {compositeForm.strengths?.length ? (
            <div className="form-strengths">
              <strong>What is working</strong>
              <ul>
                {compositeForm.strengths.map((strength) => (
                  <li key={strength.bodyPart}>
                    <span>{strength.label}</span>
                    <small>
                      {strength.current}{strength.kind === "angle" ? "°" : "%"} ·
                      ideal {strength.ideal}{strength.kind === "angle" ? "°" : "%"}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="panel-block">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live Values</p>
            <small>Full-body angle targets</small>
          </div>
          <span>{bodyParts.length} tracked</span>
        </div>

        {bodyParts.length === 0 ? (
          <p className="empty-state">No body angle targets loaded yet.</p>
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
                  <strong>{hasValue ? formatValue(value) : "--"}</strong>
                  <small>{formatTarget(part.target_angle, part.min, part.max)}</small>
                  <em>
                    {hasValue
                      ? getFeedback(value, part.min, part.max)
                      : "Waiting"}
                  </em>
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
