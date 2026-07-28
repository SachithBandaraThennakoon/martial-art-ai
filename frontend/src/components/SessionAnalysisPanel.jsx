const formatLabel = (value) =>
  value
    ? String(value)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Unavailable";

const formatDateTime = (value) => {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

const metric = (value, suffix = "") =>
  value === null || value === undefined ? "--" : `${value}${suffix}`;

export default function SessionAnalysisPanel({
  eyebrow = "Session analysis",
  session,
  title = "Selected session"
}) {
  if (!session) {
    return (
      <section className="session-analysis-panel session-analysis-panel--empty">
        <p className="eyebrow">{eyebrow}</p>
        <h2>No session selected</h2>
        <p>Complete or select a Practice session to inspect its corrected evidence.</p>
      </section>
    );
  }

  const analytics = session.analytics || session;
  const accuracy = session.average_accuracy ?? session.accuracy;
  const completedReps = session.completed_reps ?? session.reps;
  const targetReps = session.target_reps;
  const consistency = session.consistency_score ?? session.consistency;
  const tracking = analytics.tracking_quality_percentage ?? session.tracking_quality;
  const responseTime =
    analytics.average_response_time_ms ?? session.average_response_time_ms;
  const incomplete =
    analytics.aborted_repetitions ?? session.aborted_reps;
  const corrections =
    analytics.corrections_applied ?? session.corrections_applied;
  const formErrors =
    analytics.common_form_errors ?? session.form_errors ?? [];
  const stepDurations = analytics.per_step_duration_ms || {};
  const timestamp = session.ended_at || session.started_at;

  return (
    <section className="session-analysis-panel">
      <header className="session-analysis-panel__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{session.technique_name || title}</h2>
          <span>{formatDateTime(timestamp)}</span>
        </div>
        <div className="session-analysis-panel__status">
          <span className={`is-${session.status || "unknown"}`}>
            {formatLabel(session.status)}
          </span>
          {session.mode ? <small>{formatLabel(session.mode)} mode</small> : null}
        </div>
      </header>

      <div className="session-analysis-panel__metrics">
        <div><span>Corrected form</span><strong>{metric(accuracy, "%")}</strong></div>
        <div>
          <span>Repetitions</span>
          <strong>
            {completedReps == null
              ? "--"
              : targetReps == null
                ? completedReps
                : `${completedReps}/${targetReps}`}
          </strong>
        </div>
        <div><span>Consistency</span><strong>{metric(consistency, "%")}</strong></div>
        <div><span>Tracking quality</span><strong>{metric(tracking, "%")}</strong></div>
        <div><span>Response time</span><strong>{metric(responseTime, "ms")}</strong></div>
        <div><span>Incomplete reps</span><strong>{metric(incomplete)}</strong></div>
        <div><span>Timeline corrections</span><strong>{metric(corrections)}</strong></div>
        <div><span>Clean reps</span><strong>{metric(session.clean_reps)}</strong></div>
      </div>

      <div className="session-analysis-panel__evidence">
        <div>
          <span>Confirmed form errors</span>
          {formErrors.length ? (
            <ul>
              {formErrors.slice(0, 5).map((error) => (
                <li key={error.error_id || error.label}>
                  <strong>{formatLabel(error.error_id || error.label)}</strong>
                  <small>{error.count ?? 1} confirmed</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No confirmed form errors.</p>
          )}
        </div>
        <div>
          <span>Average step duration</span>
          {Object.keys(stepDurations).length ? (
            <ul>
              {Object.entries(stepDurations).slice(0, 5).map(([step, duration]) => (
                <li key={step}>
                  <strong>{formatLabel(step)}</strong>
                  <small>{duration}ms</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>Step timing is unavailable for this session.</p>
          )}
        </div>
      </div>
    </section>
  );
}
