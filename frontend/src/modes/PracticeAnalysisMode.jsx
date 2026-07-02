import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../services/api";

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
  const sessions = analysis?.sessions || [];

  return (
    <aside className="analysis-panel">
      <div className="panel-block">
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
      </div>

      <div className="panel-block coach-card">
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

      <div className="panel-block">
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
    </aside>
  );
}
