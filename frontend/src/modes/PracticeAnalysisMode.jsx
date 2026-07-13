import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../services/api";

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "None yet";

export default function PracticeAnalysisMode({ onModeChange }) {
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState("Loading analysis.");

  const loadAnalysis = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Log in to view practice analysis.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/practice/analysis`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error("Analysis request failed");
      }

      const data = await response.json();
      setAnalysis(data);
      setStatus(data.sessions.length ? "Recent practice sets" : "No practice sets yet.");
    } catch {
      setStatus("Analysis is unavailable right now.");
    }
  }, []);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const summary = analysis?.summary;
  const trainingSummary = analysis?.training_summary;
  const sessions = analysis?.sessions || [];
  const paceMix = summary?.pace_mix || {};
  const paceText = Object.entries(paceMix)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" / ");

  return (
    <section className="analysis-panel">
      <div className="panel-block analysis-hero">
        <p className="eyebrow">Practice Analysis</p>
        <h1>Rep History</h1>
        <p className="practice-copy">{status}</p>
      </div>

      <div className="practice-stats analysis-summary">
        <div>
          <span>Sessions</span>
          <strong>{summary?.total_sessions ?? 0}</strong>
        </div>
        <div>
          <span>Total reps</span>
          <strong>{summary?.total_reps ?? 0}</strong>
        </div>
        <div>
          <span>Avg form</span>
          <strong>{summary ? `${summary.average_accuracy}%` : "--"}</strong>
        </div>
        <div>
          <span>Best</span>
          <strong>{summary ? `${summary.best_accuracy}%` : "--"}</strong>
        </div>
        <div>
          <span>Complete</span>
          <strong>{summary ? `${summary.completion_rate}%` : "--"}</strong>
        </div>
        <div>
          <span>Clean rate</span>
          <strong>{summary ? `${summary.clean_rate}%` : "--"}</strong>
        </div>
        <div>
          <span>Consistency</span>
          <strong>{summary ? `${summary.consistency_score}%` : "--"}</strong>
        </div>
        <div>
          <span>Avg pace</span>
          <strong>{summary ? `${summary.average_rep_seconds}s` : "--"}</strong>
        </div>
      </div>

      <div className="panel-block coach-card analysis-recommendation">
        <p className="eyebrow">Recommendation</p>
        <p className="coach-feedback">
          {summary?.recommendation || "Start a fixed-count practice set."}
        </p>
        <button
          className="btn btn--light btn--full"
          onClick={() => onModeChange?.("practice")}
          type="button"
        >
          Start Practice
        </button>
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
                  <span>{session.step_name || "Whole technique"}</span>
                </div>
                <div>
                  <strong>{session.completed_reps}/{session.target_reps}</strong>
                  <span>{session.average_accuracy}% avg</span>
                </div>
                <div>
                  <strong>{session.clean_reps}</strong>
                  <span>clean</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
