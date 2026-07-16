import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../services/api";

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "None yet";

const formatDateTime = (value) => {
  if (!value) return "No activity yet";
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

const formatDashboardDate = () =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());

export default function PracticeAnalysisMode({
  hasTechniqueSelection = false,
  onModeChange,
  onOpenLibrary
}) {
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState("Loading analysis.");
  const [loadState, setLoadState] = useState("loading");

  const loadAnalysis = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Log in to view practice analysis.");
      setLoadState("error");
      return;
    }

    setLoadState("loading");
    setStatus("Loading your latest training patterns.");
    try {
      const response = await fetch(`${API_BASE_URL}/practice/analysis`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal
      });

      if (!response.ok) {
        throw new Error(response.status === 401 ? "session" : "request");
      }

      const data = await response.json();
      setAnalysis(data);
      setLoadState("ready");
      setStatus(data.sessions.length ? "Recent practice sets" : "No practice sets yet.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setLoadState("error");
      setStatus(
        error.message === "session"
          ? "Your session expired. Sign in again to view analysis."
          : "Analysis is unavailable right now. Your saved training data is safe."
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAnalysis(controller.signal);
    return () => controller.abort();
  }, [loadAnalysis]);

  const summary = analysis?.summary;
  const trainingSummary = analysis?.training_summary;
  const sessions = analysis?.sessions || [];
  const paceMix = summary?.pace_mix || {};
  const paceText = Object.entries(paceMix)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" / ");
  const hasSessions = sessions.length > 0;
  const latestSession = sessions.find((session) => session.status === "completed") || sessions[0];
  const previousSession = sessions.find(
    (session) => session.id !== latestSession?.id && session.status === "completed"
  );
  const accuracyChange = latestSession && previousSession
    ? Math.round((latestSession.average_accuracy - previousSession.average_accuracy) * 10) / 10
    : null;

  if (loadState === "error") {
    return (
      <section className="analysis-panel analysis-panel--state" aria-live="polite">
        <div className="panel-block analysis-state-card">
          <p className="eyebrow">Practice Analysis</p>
          <h1>Analysis needs attention</h1>
          <p className="practice-copy">{status}</p>
          <div className="analysis-state-actions">
            <button className="btn btn--light" onClick={() => loadAnalysis()} type="button">
              Try again
            </button>
            <button className="btn btn--ghost" onClick={onOpenLibrary} type="button">
              Open library
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="analysis-panel analysis-dashboard" aria-busy={loadState === "loading"}>
      <div className="panel-block analysis-hero analysis-dashboard-hero">
        <div>
          <p className="eyebrow">Performance Dashboard</p>
          <h1>{loadState === "loading" ? "Reading your sessions" : "Training intelligence"}</h1>
          <p className="practice-copy">{status}. Use the latest pattern to choose your next session.</p>
        </div>
        <div className="analysis-dashboard-hero__meta">
          <span>{formatDashboardDate()}</span>
          <strong>{formatDateTime(latestSession?.ended_at || latestSession?.started_at)}</strong>
          {loadState === "ready" ? (
            <button className="analysis-refresh" onClick={() => loadAnalysis()} type="button">
              Refresh data
            </button>
          ) : null}
        </div>
      </div>

      <div className="practice-stats analysis-summary">
        <div className="analysis-kpi analysis-kpi--primary">
          <span>Sessions</span>
          <strong>{summary?.total_sessions ?? (loadState === "loading" ? "--" : 0)}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Total reps</span>
          <strong>{summary?.total_reps ?? (loadState === "loading" ? "--" : 0)}</strong>
        </div>
        <div className="analysis-kpi analysis-kpi--primary">
          <span>Avg form</span>
          <strong>{summary ? `${summary.average_accuracy}%` : "--"}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Best</span>
          <strong>{summary ? `${summary.best_accuracy}%` : "--"}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Complete</span>
          <strong>{summary ? `${summary.completion_rate}%` : "--"}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Clean rate</span>
          <strong>{summary ? `${summary.clean_rate}%` : "--"}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Consistency</span>
          <strong>{summary ? `${summary.consistency_score}%` : "--"}</strong>
        </div>
        <div className="analysis-kpi">
          <span>Avg pace</span>
          <strong>{summary ? `${summary.average_rep_seconds}s` : "--"}</strong>
        </div>
      </div>

      <div className="panel-block analysis-latest-set">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Latest completed set</p>
            <h2>{latestSession?.technique_name || "No set completed"}</h2>
          </div>
          <span className={`analysis-delta ${accuracyChange === null ? "" : accuracyChange >= 0 ? "is-positive" : "is-negative"}`}>
            {accuracyChange === null ? "First baseline" : `${accuracyChange > 0 ? "+" : ""}${accuracyChange}% vs prior`}
          </span>
        </div>
        <time dateTime={latestSession?.ended_at || latestSession?.started_at || undefined}>
          {formatDateTime(latestSession?.ended_at || latestSession?.started_at)}
        </time>
        <div className="analysis-latest-set__metrics">
          <div><span>Form</span><strong>{latestSession ? `${latestSession.average_accuracy}%` : "--"}</strong></div>
          <div><span>Reps</span><strong>{latestSession ? `${latestSession.completed_reps}/${latestSession.target_reps}` : "--"}</strong></div>
          <div><span>Clean</span><strong>{latestSession?.clean_reps ?? "--"}</strong></div>
          <div><span>Consistency</span><strong>{latestSession ? `${latestSession.consistency_score}%` : "--"}</strong></div>
        </div>
      </div>

      <div className="panel-block coach-card analysis-recommendation">
        <p className="eyebrow">Recommendation</p>
        <p className="coach-feedback">
          {summary?.recommendation || "Complete a fixed-count practice set to receive a personal recommendation."}
        </p>
        <button
          className="btn btn--light btn--full"
          onClick={() => hasTechniqueSelection ? onModeChange?.("practice") : onOpenLibrary?.()}
          type="button"
        >
          {hasTechniqueSelection
            ? (hasSessions ? "Practice recommendation" : "Start first practice")
            : "Choose a technique"}
        </button>
        {hasTechniqueSelection ? (
          <button className="btn btn--ghost btn--full" onClick={() => onModeChange?.("train")} type="button">
            Return to guided training
          </button>
        ) : null}
      </div>

      <div className="panel-block analysis-training-card">
        <div className="panel-heading">
          <div><p className="eyebrow">Guided training intelligence</p><h2>Coach pattern</h2></div>
          <span>{trainingSummary?.total_sessions ?? 0} sessions</span>
        </div>
        <p className="coach-feedback">{trainingSummary?.recommendation || "Complete a Train session to connect guided feedback with your practice history."}</p>
        <div className="analysis-insight-grid">
          <div><span>Recurring focus</span><strong>{formatBodyPart(trainingSummary?.frequent_focus)}</strong></div>
          <div><span>Common issue</span><strong>{formatBodyPart(trainingSummary?.frequent_issue)}</strong></div>
          <div><span>Guided form</span><strong>{trainingSummary ? `${trainingSummary.average_accuracy}%` : "--"}</strong></div>
          <div><span>Completed</span><strong>{trainingSummary?.completed_sessions ?? 0}</strong></div>
        </div>
      </div>

      <div className="panel-block analysis-insights">
        <p className="eyebrow">Focus</p>
        <div className="analysis-insight-grid">
          <div>
            <span>Needs attention</span>
            <strong>{formatBodyPart(summary?.weak_focus)}</strong>
          </div>
          <div>
            <span>Pace mix</span>
            <strong>{paceText || "No reps yet"}</strong>
          </div>
        </div>
      </div>

      <div className="panel-block analysis-trend-card">
        <div className="panel-heading">
          <p className="eyebrow">Trend</p>
          <span>{summary?.trend?.length || 0}</span>
        </div>
        <div className="analysis-trend">
          {(summary?.trend || []).length === 0 ? (
            <p className="empty-state">Practice history will appear here.</p>
          ) : (
            summary.trend.map((item) => (
              <div className="analysis-trend__bar" key={item.session_id}>
                <span>{item.completed_reps}/{item.target_reps}</span>
                <strong style={{ width: `${Math.max(4, item.average_accuracy)}%` }}>
                  {item.average_accuracy}%
                </strong>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel-block analysis-recent">
        <div className="panel-heading">
          <p className="eyebrow">Recent Sets</p>
          <span>{sessions.length}</span>
        </div>
        <div className="analysis-list">
          {sessions.length === 0 ? (
            <p className="empty-state">Complete a practice set to build analysis.</p>
          ) : (
            sessions.map((session) => (
              <article className="analysis-row" key={session.id}>
                <div>
                  <strong>{session.technique_name}</strong>
                  <span>{formatDateTime(session.ended_at || session.started_at)}</span>
                </div>
                <div>
                  <strong>{session.completed_reps}/{session.target_reps}</strong>
                  <span>{session.average_accuracy}% avg</span>
                </div>
                <div>
                  <strong>{session.consistency_score}%</strong>
                  <span>{session.clean_reps} clean</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
