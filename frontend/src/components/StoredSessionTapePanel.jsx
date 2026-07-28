import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { buildPracticeSessionAnalysis } from "../utils/practiceSessionAnalysis";

const CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
];
const VISIBLE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const restoreCoordinate = (value) =>
  Number.isFinite(value) ? value / 10000 : null;

const decodePose = (landmarks = []) =>
  landmarks.map(([x, y, z, visibility]) => ({
    x: restoreCoordinate(x),
    y: restoreCoordinate(y),
    z: restoreCoordinate(z),
    visibility: Number.isFinite(visibility) ? restoreCoordinate(visibility) : 1
  }));

const decodeFrame = (frame, index) => ({
  elapsedMs: frame.t || 0,
  frame: frame.n || index + 1,
  rep: frame.r || 1,
  step: frame.s || 1,
  accuracy: frame.a ?? null,
  focusBodyPart: frame.f || null,
  issue: frame.i || null,
  wrongBodyParts: frame.w || [],
  landmarks: decodePose(frame.p),
  trackingConfidence: Number.isFinite(frame.tc) ? frame.tc / 1000 : null,
  phase: frame.ph || "keyframe",
  temporalPhase: frame.tp || "between_steps",
  stateConfidence: frame.cf ?? null,
  trackingReliable: frame.tr !== false,
  liveRep: frame.lr ?? null,
  liveStep: frame.ls ?? null,
  matchedStep: frame.ms ?? null,
  countedRep: frame.nr ?? null,
  completedRep: frame.dr ?? null,
  postSessionClassified: frame.ps === true,
  scorable: frame.sc !== false
});

function StoredTapeSkeleton({ landmarks = [], mirrored = true }) {
  const pointAt = (index) => {
    const point = landmarks[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * 100
    };
  };
  return (
    <svg aria-hidden="true" className="practice-tape-skeleton" viewBox="0 0 100 100">
      {CONNECTIONS.map(([from, to]) => {
        const start = pointAt(from);
        const end = pointAt(to);
        return start && end ? (
          <line key={`${from}-${to}`} x1={start.x} x2={end.x} y1={start.y} y2={end.y} />
        ) : null;
      })}
      {VISIBLE_JOINTS.map((index) => {
        const point = pointAt(index);
        return point ? <circle cx={point.x} cy={point.y} key={index} r={index === 0 ? 3 : 1.8} /> : null;
      })}
      {!landmarks.length ? <text x="50" y="52" textAnchor="middle">POSE</text> : null}
    </svg>
  );
}

function StoredSessionMap({ analysis, onSelectFrame, selectedFrame }) {
  if (!analysis?.segments?.length) return null;
  const duration = Math.max(analysis.duration_ms, 1);
  return (
    <section className="stored-tape-panel__map">
      <div>
        <p className="eyebrow">Session map</p>
        <strong>Movement timeline</strong>
        <span>{analysis.clustered_completed_repetitions}/{analysis.target_repetitions} completed</span>
      </div>
      <div className="stored-tape-panel__segments">
        {analysis.segments.map((segment, index) => (
          <button
            className={`is-${segment.kind} ${
              segment.has_review ? "has-review" : ""
            } ${
              selectedFrame >= segment.start_frame_index &&
              selectedFrame <= segment.end_frame_index
                ? "is-selected"
                : ""
            }`}
            key={`${segment.key}-${index}`}
            onClick={() => onSelectFrame(segment.start_frame_index)}
            style={{ flexGrow: Math.max(1, segment.duration_ms / duration * 100) }}
            title={`${segment.phase_label} · ${Math.round(segment.duration_ms)}ms`}
            type="button"
          >
            <strong>{segment.kind === "preparation" ? "PREP" : segment.rep ? `R${segment.rep} S${segment.step}` : "MOVE"}</strong>
            <small>{segment.phase_label}</small>
          </button>
        ))}
      </div>
      <div className="stored-tape-panel__reps">
        {analysis.repetitions.map((repetition) => (
          <button
            className={`is-${repetition.status}`}
            key={repetition.rep}
            onClick={() => onSelectFrame(repetition.start_frame_index)}
            type="button"
          >
            <span>Rep {repetition.rep}</span>
            <strong>{formatLabel(repetition.status)}</strong>
            <small>{repetition.step_coverage_percentage}% steps</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const practiceSessionId = (session) => {
  if (session?.mode && session.mode !== "practice") return null;
  const value = String(session?.id ?? "");
  const match = value.match(/^(?:practice-)?(\d+)$/);
  return match ? Number(match[1]) : null;
};

const formatTime = (milliseconds = 0) => {
  const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
};

const formatLabel = (value) =>
  value
    ? String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Preparation";

function AccuracyStrip({ frames, selectedFrame, onSelectFrame }) {
  const scored = frames.filter(
    (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
  );
  if (!scored.length) {
    return <div className="stored-tape-panel__accuracy-empty">No scored frames in this tape.</div>;
  }
  const duration = Math.max(frames.at(-1)?.elapsedMs || 0, 1);
  const points = scored.map((frame) => ({
    x: (frame.elapsedMs / duration) * 1000,
    y: 110 - (Math.max(0, Math.min(100, frame.accuracy)) / 100) * 90,
    frame
  }));
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="stored-tape-panel__accuracy">
      <div><span>Session accuracy</span><small>Click a point to inspect the frame</small></div>
      <svg aria-label="Stored session accuracy timeline" role="img" viewBox="0 0 1000 125">
        <line x1="0" x2="1000" y1="38" y2="38" />
        <path d={path} />
        {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 40)) === 0).map((point) => (
          <circle
            className={point.frame.frame - 1 === selectedFrame ? "is-selected" : ""}
            cx={point.x}
            cy={point.y}
            key={point.frame.frame}
            onClick={() => onSelectFrame(point.frame.frame - 1)}
            r={point.frame.frame - 1 === selectedFrame ? 6 : 3}
          />
        ))}
      </svg>
    </div>
  );
}

export default function StoredSessionTapePanel({
  defaultExpanded = false,
  session
}) {
  const sessionId = practiceSessionId(session);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loadState, setLoadState] = useState("idle");
  const [message, setMessage] = useState("");
  const [tape, setTape] = useState(null);
  const [selectedFrame, setSelectedFrame] = useState(0);

  const loadTape = useCallback(async () => {
    if (!sessionId || loadState === "loading") return;
    const token = localStorage.getItem("token");
    if (!token) {
      setLoadState("error");
      setMessage("Log in to load this stored tape.");
      return;
    }
    setLoadState("loading");
    setMessage("Loading the stored 30 FPS movement tape.");
    try {
      const response = await fetch(
        `${API_BASE_URL}/practice/sessions/${sessionId}/tape`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error(response.status === 404 ? "missing" : "request");
      const data = await response.json();
      const frames = (data.frames || []).map(decodeFrame);
      setTape({ ...data, frames });
      setLoadState("ready");
      setMessage("");
    } catch (error) {
      setLoadState("error");
      setMessage(
        error.message === "missing"
          ? "No frame tape was stored for this session."
          : "The stored tape could not be loaded."
      );
    }
  }, [loadState, sessionId]);

  useEffect(() => {
    if (expanded && sessionId && loadState === "idle") loadTape();
  }, [expanded, loadState, loadTape, sessionId]);

  const frames = useMemo(() => tape?.frames || [], [tape]);
  const steps = useMemo(() => tape?.metadata?.steps || [], [tape]);
  const analysis = useMemo(
    () =>
      frames.length
        ? buildPracticeSessionAnalysis(frames, {
            steps,
            targetReps: session?.target_reps
          })
        : null,
    [frames, session?.target_reps, steps]
  );
  const currentFrame = frames[selectedFrame] || null;
  const assignment = analysis?.frame_assignments?.[selectedFrame] || null;
  const scoredFrames = frames.filter(
    (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
  );
  const averageAccuracy = scoredFrames.length
    ? Math.round(
        scoredFrames.reduce((sum, frame) => sum + frame.accuracy, 0) /
          scoredFrames.length
      )
    : null;

  if (!sessionId) return null;

  return (
    <section className={`stored-tape-panel ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <header className="stored-tape-panel__header">
        <div>
          <p className="eyebrow">Full session analysis</p>
          <strong>
            {session?.completed_reps ?? session?.reps ?? 0}/
            {session?.target_reps ?? 0} reps
            {frames.length ? ` · ${frames.length} frames · ${formatTime(tape?.duration_ms)}` : ""}
          </strong>
        </div>
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Collapse" : "Expand full tape"}
        </button>
      </header>

      {expanded ? (
        <div className="stored-tape-panel__body">
          {loadState === "loading" ? <p className="stored-tape-panel__state">{message}</p> : null}
          {loadState === "error" ? (
            <div className="stored-tape-panel__state is-error">
              <p>{message}</p>
              <button onClick={loadTape} type="button">Try again</button>
            </div>
          ) : null}
          {loadState === "ready" && analysis && currentFrame ? (
            <>
              <StoredSessionMap
                analysis={analysis}
                onSelectFrame={setSelectedFrame}
                selectedFrame={selectedFrame}
              />
              <AccuracyStrip
                frames={frames}
                onSelectFrame={setSelectedFrame}
                selectedFrame={selectedFrame}
              />
              <input
                aria-label="Selected tape frame"
                max={Math.max(0, frames.length - 1)}
                min="0"
                onChange={(event) => setSelectedFrame(Number(event.target.value))}
                type="range"
                value={selectedFrame}
              />
              <div className="stored-tape-panel__inspection">
                <div className="stored-tape-panel__details">
                  <p className="eyebrow">Movement details</p>
                  <h3>Selected moment</h3>
                  <div>
                    <span><small>Timestamp</small><strong>{formatTime(currentFrame.elapsedMs)}</strong></span>
                    <span><small>Rep</small><strong>{assignment?.rep || "Preparation"}</strong></span>
                    <span>
                      <small>Step</small>
                      <strong>
                        {assignment?.step
                          ? steps[Math.max(0, assignment.step - 1)]?.step_name ||
                            `Step ${assignment.step}`
                          : "Preparation"}
                      </strong>
                    </span>
                    <span><small>Phase</small><strong>{formatLabel(assignment?.phase)}</strong></span>
                    <span><small>Accuracy</small><strong>{Number.isFinite(currentFrame.accuracy) ? `${currentFrame.accuracy}%` : "Not scored"}</strong></span>
                    <span><small>Tracking</small><strong>{currentFrame.trackingReliable === false ? "Lost" : "Tracked"}</strong></span>
                  </div>
                  <div className="stored-tape-panel__summary">
                    <span><small>Average</small><strong>{averageAccuracy == null ? "--" : `${averageAccuracy}%`}</strong></span>
                    <span><small>Review frames</small><strong>{scoredFrames.filter((frame) => frame.accuracy < 80).length}</strong></span>
                    <span><small>Reps</small><strong>{analysis.clustered_completed_repetitions}/{analysis.target_repetitions}</strong></span>
                    <span><small>Tracking</small><strong>{analysis.tracking_quality_percentage}%</strong></span>
                  </div>
                </div>
                <div className="stored-tape-panel__skeleton">
                  <div><span>Selected frame</span><strong>Frame {selectedFrame + 1}</strong></div>
                  <StoredTapeSkeleton
                    landmarks={currentFrame.landmarks}
                    mirrored
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
