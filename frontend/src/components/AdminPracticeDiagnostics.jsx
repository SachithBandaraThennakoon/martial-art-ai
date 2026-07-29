import { useMemo, useState } from "react";

const percent = (value) =>
  Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "--";
const label = (value) => value ? String(value).replaceAll("_", " ") : "--";

function ScoreRows({ scores }) {
  return (
    <div className="admin-live-diagnostics__scores">
      {Object.entries(scores || {})
        .sort((left, right) => right[1] - left[1])
        .map(([state, score]) => (
          <div key={state}>
            <span>{label(state)}</span>
            <i><b style={{ width: percent(score) }} /></i>
            <strong>{percent(score)}</strong>
          </div>
        ))}
    </div>
  );
}

export default function AdminPracticeDiagnostics({
  ruleFrame,
  level2State,
  level3State,
  situationAwarenessState,
  events,
  onClearEvents
}) {
  const [enabled, setEnabled] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [showScores, setShowScores] = useState(true);
  const [showLearned, setShowLearned] = useState(true);
  const [showAwareness, setShowAwareness] = useState(true);
  const [snapshot, setSnapshot] = useState(null);

  const frame = frozen ? snapshot : ruleFrame || snapshot;
  const learned = frame?.learned_state_prediction;
  const action = level2State?.action_context || {};
  const session = level3State?.session_context || {};
  const situation = situationAwarenessState?.situation_context || {};
  const comparison = useMemo(() => {
    const ruleTop = Object.entries(frame?.state_scores || {})
      .sort((left, right) => right[1] - left[1])[0];
    return {
      ruleState: ruleTop?.[0] || null,
      ruleConfidence: ruleTop?.[1],
      agree: Boolean(ruleTop?.[0] && learned?.state === ruleTop[0])
    };
  }, [frame, learned?.state]);

  return (
    <section className="admin-live-diagnostics">
      <button
        className="advanced-analysis-button"
        type="button"
        aria-expanded={enabled}
        onClick={() => setEnabled((value) => !value)}
      >
        Live session diagnostics
        <span>{enabled ? "Hide" : "Open"}</span>
      </button>
      {enabled && (
        <>
          <div className="admin-live-diagnostics__options">
            <label><input type="checkbox" checked={frozen} onChange={(event) => {
              if (event.target.checked) setSnapshot(ruleFrame);
              setFrozen(event.target.checked);
            }} /> Freeze</label>
            <label><input type="checkbox" checked={showScores} onChange={(event) => setShowScores(event.target.checked)} /> Rule scores</label>
            <label><input type="checkbox" checked={showLearned} onChange={(event) => setShowLearned(event.target.checked)} /> Learned shadow</label>
            <label><input type="checkbox" checked={showAwareness} onChange={(event) => setShowAwareness(event.target.checked)} /> Awareness</label>
            <button type="button" onClick={onClearEvents}>Clear events</button>
          </div>

          <div className="admin-live-diagnostics__kpis">
            <article><span>Confirmed phase</span><strong>{label(frame?.step)}</strong><small>{percent(frame?.confidence)}</small></article>
            <article><span>Rep state</span><strong>{label(frame?.rep_state)}</strong><small>{frame?.rep_id || "No active rep"}</small></article>
            <article><span>Tracking</span><strong>{percent(frame?.tracking_confidence)}</strong><small>{frame?.tracking_lost ? "Lost" : "Visible"}</small></article>
            <article><span>Live cluster</span><strong>{label(action.temporal_segmentation?.frame_label)}</strong><small>{label(action.temporal_segmentation?.motion_phase)}</small></article>
          </div>

          {showLearned && (
            <div className="admin-live-diagnostics__comparison">
              <div>
                <span>Rule candidate</span>
                <strong>{label(comparison.ruleState)} · {percent(comparison.ruleConfidence)}</strong>
              </div>
              <div>
                <span>Learned prediction</span>
                <strong>{label(learned?.state)} · {percent(learned?.confidence)}</strong>
              </div>
              <b className={comparison.agree ? "is-agree" : "is-different"}>
                {learned ? (comparison.agree ? "Agree" : "Different · shadow only") : "Model warming up"}
              </b>
            </div>
          )}

          {showScores && (
            <div className="admin-live-diagnostics__columns">
              <div><h4>Rule evidence</h4><ScoreRows scores={frame?.state_scores} /></div>
              {showLearned && <div><h4>Learned probabilities</h4><ScoreRows scores={learned?.probabilities} /></div>}
            </div>
          )}

          {showAwareness && (
            <dl className="admin-live-diagnostics__awareness">
              <div><dt>Session state</dt><dd>{label(session.session_state)}</dd></div>
              <div><dt>Session phase</dt><dd>{label(session.temporal_phase)}</dd></div>
              <div><dt>Situation</dt><dd>{label(situation.situation_state)}</dd></div>
              <div><dt>Attention</dt><dd>{label(situation.attention_target?.body_part || situation.attention_target?.layer)}</dd></div>
              <div><dt>Decision</dt><dd>{label(situation.feedback_decision?.action)}</dd></div>
              <div><dt>Next action</dt><dd>{label(situation.next_action?.action || situation.next_action?.type)}</dd></div>
            </dl>
          )}

          <div className="admin-live-diagnostics__events">
            <strong>Recent temporal events</strong>
            {events.length ? events.map((event) => (
              <div key={event.id}>
                <time>{Math.round(event.timestamp_ms)} ms</time>
                <span>{label(event.type)}</span>
                <b>{label(event.from_state)} → {label(event.to_state)}</b>
              </div>
            )) : <small>No transition confirmed yet.</small>}
          </div>
        </>
      )}
    </section>
  );
}
