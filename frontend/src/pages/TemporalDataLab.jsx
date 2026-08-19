import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import SkeletonCanvas from "../components/SkeletonCanvas";
import {
  getTechniqueTrackingPackage,
  slugify
} from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";
import { API_BASE_URL } from "../services/api";
import { authFetch, getAccessToken } from "../services/authSession";
import { validateTemporalModelMetadata } from "../tracking/temporalModelContract";

const CONTEXT_LABELS = [
  "__UNKNOWN__",
  "__TRACKING_LOST__",
  "SESSION_START",
  "IDLE",
  "PREPARATION",
  "REP_START",
  "TRANSITION",
  "STEP_HOLD",
  "REP_RECOVERY",
  "REP_END",
  "INCOMPLETE_REP",
  "INCORRECT_MOVEMENT",
  "SESSION_END"
];
const TARGET_FPS = 30;
const LABEL_DESCRIPTIONS = {
  __UNKNOWN__: "The correct state cannot be determined from this frame range.",
  __TRACKING_LOST__: "The body is missing, heavily occluded, or landmarks are unreliable.",
  SESSION_START: "Short context at the beginning of the recorded session.",
  IDLE: "The person is visible but not preparing or performing the technique.",
  PREPARATION: "The person gets ready before entering the first technique state.",
  REP_START: "The repetition begins; use only for a short boundary range.",
  TRANSITION: "Movement between states when no specific transition label is available.",
  STEP_HOLD: "A technique state is intentionally held with little movement.",
  REP_RECOVERY: "Movement after the final action while returning to the starting guard or stance.",
  REP_END: "The repetition finishes; use only for a short boundary range.",
  INCOMPLETE_REP: "A repetition starts but does not complete the expected state sequence.",
  INCORRECT_MOVEMENT: "Visible movement is not a valid execution of the selected technique.",
  SESSION_END: "Short context at the end of the recorded session."
};
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28]
];

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload)], { type: "application/json" })
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function compactPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map((point) => [
    Math.round((Number(point?.x) || 0) * 10000),
    Math.round((Number(point?.y) || 0) * 10000),
    Math.round((Number(point?.z) || 0) * 10000),
    Math.round((Number(point?.visibility) || 0) * 10000)
  ]);
}

function restorePoints(points) {
  return (points || []).map((point) => ({
    x: (point?.[0] || 0) / 10000,
    y: (point?.[1] || 0) / 10000,
    visibility: (point?.[3] || 0) / 10000
  }));
}

function compactPoint3(points, index) {
  const point = points?.[index];
  return Array.isArray(point) ? point.slice(0, 3).map((value) => Number(value || 0) / 10000) : null;
}

function vectorDistance(first, second) {
  return Math.hypot(
    (first?.[0] || 0) - (second?.[0] || 0),
    (first?.[1] || 0) - (second?.[1] || 0),
    (first?.[2] || 0) - (second?.[2] || 0)
  );
}

function jointAngle(first, center, last) {
  if (!first || !center || !last) return 0;
  const left = first.map((value, index) => value - center[index]);
  const right = last.map((value, index) => value - center[index]);
  const denominator = Math.hypot(...left) * Math.hypot(...right);
  if (denominator < 1e-8) return 0;
  const cosine = left.reduce((sum, value, index) => sum + value * right[index], 0) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function enrichFramesWithPhysics(frames, leadSide = "left") {
  const indexes = leadSide === "right"
    ? { shoulder: 12, elbow: 14, wrist: 16 }
    : { shoulder: 11, elbow: 13, wrist: 15 };
  let previousVelocity = 0;
  let previousAngle = null;
  return frames.map((frame, index) => {
    const shoulder = compactPoint3(frame.wp, indexes.shoulder);
    const elbow = compactPoint3(frame.wp, indexes.elbow);
    const wrist = compactPoint3(frame.wp, indexes.wrist);
    const angle = jointAngle(shoulder, elbow, wrist);
    let velocity = 0;
    let acceleration = 0;
    let angularVelocity = 0;
    let derivedMotion = 0;
    if (index > 0) {
      const previous = frames[index - 1];
      const priorWrist = compactPoint3(previous.wp, indexes.wrist);
      const deltaSeconds = Math.max((frame.t - previous.t) / 1000, 0.001);
      velocity = ((priorWrist?.[2] || 0) - (wrist?.[2] || 0)) / deltaSeconds;
      acceleration = (velocity - previousVelocity) / deltaSeconds;
      angularVelocity = (angle - (previousAngle ?? angle)) / deltaSeconds;
      const comparable = Math.min(frame.wp?.length || 0, previous.wp?.length || 0);
      if (comparable) {
        derivedMotion = Array.from({ length: comparable }, (_, pointIndex) =>
          vectorDistance(
            compactPoint3(frame.wp, pointIndex),
            compactPoint3(previous.wp, pointIndex)
          )
        ).reduce((sum, value) => sum + value, 0) / comparable / deltaSeconds;
      }
    }
    previousVelocity = velocity;
    previousAngle = angle;
    return {
      ...frame,
      a: {
        ...(frame.a || {}),
        lead_elbow_angle: Number(angle.toFixed(3)),
        lead_elbow_angular_velocity: Number(angularVelocity.toFixed(3)),
        lead_wrist_forward_velocity: Number(velocity.toFixed(4))
      },
      ph: {
        lead_side: leadSide,
        lead_elbow_angle: Number(angle.toFixed(3)),
        lead_elbow_angular_velocity: Number(angularVelocity.toFixed(3)),
        lead_wrist_forward_velocity: Number(velocity.toFixed(4)),
        lead_wrist_forward_acceleration: Number(acceleration.toFixed(4)),
        motion_energy: Number((frame.me || derivedMotion).toFixed(4))
      }
    };
  });
}

function describeLabel(label) {
  if (LABEL_DESCRIPTIONS[label]) return LABEL_DESCRIPTIONS[label];
  const transition = label.match(/^(.+)_TO_(.+)$/);
  if (transition) {
    return `Movement leaving ${transition[1].replaceAll("_", " ")} and entering ${transition[2].replaceAll("_", " ")}.`;
  }
  return "A technique-specific state or custom label. Apply it while this pose or phase is active.";
}

function mergeSegments(segments) {
  return [...segments]
    .sort((left, right) => left.start_frame - right.start_frame)
    .reduce((merged, segment) => {
      const previous = merged[merged.length - 1];
      if (
        previous &&
        previous.state === segment.state &&
        previous.rep === segment.rep &&
        previous.end_frame + 1 === segment.start_frame
      ) {
        previous.end_frame = segment.end_frame;
      } else {
        merged.push({ ...segment });
      }
      return merged;
    }, []);
}

function applyRangeLabel(segments, start, end, state, rep) {
  const replacement = { start_frame: start, end_frame: end, state, rep };
  const remaining = segments.flatMap((segment) => {
    if (segment.end_frame < start || segment.start_frame > end) return [segment];
    const pieces = [];
    if (segment.start_frame < start) {
      pieces.push({ ...segment, end_frame: start - 1 });
    }
    if (segment.end_frame > end) {
      pieces.push({ ...segment, start_frame: end + 1 });
    }
    return pieces;
  });
  return mergeSegments([...remaining, replacement]);
}

function StateTimeline({ frameCount, segments, cursor, onSelect }) {
  if (!frameCount) return <div className="temporal-recorder__empty">No recording yet.</div>;
  return (
    <div className="temporal-recorder__timeline" aria-label="Manual label timeline">
      {segments.map((segment, index) => {
        const width = ((segment.end_frame - segment.start_frame + 1) / frameCount) * 100;
        return (
          <button
            key={`${segment.start_frame}-${segment.end_frame}-${index}`}
            type="button"
            className={cursor >= segment.start_frame && cursor <= segment.end_frame ? "is-selected" : ""}
            style={{ width: `${width}%` }}
            title={`${segment.state}: frames ${segment.start_frame}-${segment.end_frame}`}
            onClick={() => onSelect(segment)}
          >
            <strong>{segment.state.replaceAll("_", " ")}</strong>
            <small>{segment.start_frame}–{segment.end_frame}</small>
          </button>
        );
      })}
    </div>
  );
}

function SkeletonPreview({ frame }) {
  const points = restorePoints(frame?.p);
  if (!points.length) {
    return <div className="temporal-recorder__empty">Move the timeline cursor to inspect a frame.</div>;
  }
  return (
    <svg className="temporal-recorder__skeleton" viewBox="0 0 1000 1000" aria-label="Selected pose frame">
      {POSE_CONNECTIONS.map(([from, to]) => {
        const first = points[from];
        const second = points[to];
        if (!first || !second || first.visibility < 0.15 || second.visibility < 0.15) return null;
        return <line key={`${from}-${to}`} x1={(1 - first.x) * 1000} y1={first.y * 1000}
          x2={(1 - second.x) * 1000} y2={second.y * 1000} />;
      })}
      {points.map((point, index) => point.visibility >= 0.15 ? (
        <circle key={index} cx={(1 - point.x) * 1000} cy={point.y * 1000} r={index === 0 ? 12 : 8} />
      ) : null)}
    </svg>
  );
}

export default function TemporalDataLab() {
  const { catalog } = useCatalog();
  const techniques = catalog.flatMap((category) => category.subcategories.flatMap((subcategory) =>
    subcategory.techniques.map((technique) => ({ ...technique, category: category.category, subcategory: subcategory.name }))));
  const [techniqueId, setTechniqueId] = useState(techniques[0]?.id || "");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [frames, setFrames] = useState([]);
  const [segments, setSegments] = useState([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selectedState, setSelectedState] = useState("__UNKNOWN__");
  const [rep, setRep] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [completed, setCompleted] = useState([]);
  const [customLabels, setCustomLabels] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const [status, setStatus] = useState("Enable the camera, then press Start recording.");
  const [modelStatus, setModelStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Loading saved draft…");
  const [editingSessionId, setEditingSessionId] = useState(null);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastCapturedAtRef = useRef(0);
  const frameBufferRef = useRef([]);

  const technique = useMemo(
    () => techniques.find((item) => item.id === techniqueId) || techniques[0],
    [techniqueId, techniques]
  );
  const trackingPackage = useMemo(
    () => getTechniqueTrackingPackage(technique),
    [technique]
  );
  const stateNames = useMemo(() => {
    const names = trackingPackage?.stateNames || [];
    const orderedTechniqueLabels = names.flatMap((state, index) => (
      index < names.length - 1
        ? [state, `${state}_TO_${names[index + 1]}`]
        : [state]
    ));
    return [...new Set([
      "SESSION_START",
      "IDLE",
      "PREPARATION",
      "REP_START",
      ...orderedTechniqueLabels,
      "REP_RECOVERY",
      "REP_END",
      "SESSION_END",
      "STEP_HOLD",
      "INCOMPLETE_REP",
      "INCORRECT_MOVEMENT",
      "__TRACKING_LOST__",
      "__UNKNOWN__",
      "TRANSITION",
      ...customLabels
    ])];
  }, [customLabels, trackingPackage]);
  const techniqueSequence = useMemo(() => {
    const names = trackingPackage?.stateNames || [];
    return names.flatMap((state, index) => (
      index < names.length - 1
        ? [state, `${state}_TO_${names[index + 1]}`]
        : [state]
    ));
  }, [trackingPackage]);
  const expectedSequence = useMemo(() => [
    "SESSION_START",
    "IDLE",
    "PREPARATION",
    "REP_START",
    ...techniqueSequence,
    "REP_RECOVERY",
    "REP_END",
    "IDLE",
    "SESSION_END"
  ], [techniqueSequence]);
  const exceptionLabels = [
    "STEP_HOLD",
    "INCOMPLETE_REP",
    "INCORRECT_MOVEMENT",
    "__TRACKING_LOST__",
    "__UNKNOWN__",
    "TRANSITION"
  ];
  const transitionLabels = useMemo(
    () => techniqueSequence.filter((state) => state.includes("_TO_")),
    [techniqueSequence]
  );
  const measurementParts = useMemo(
    () => [...new Set((technique?.steps || []).flatMap((step) =>
      (step.angles || []).map((angle) => angle.body_part)
    ))],
    [technique]
  );
  const maxFrame = Math.max(0, frames.length - 1);
  const captureQuality = useMemo(() => {
    if (frames.length < 2) return null;
    const duration = Math.max(1, frames.at(-1).t - frames[0].t);
    const effectiveFps = (frames.length - 1) * 1000 / duration;
    const gaps = frames.slice(1).map((frame, index) => frame.t - frames[index].t);
    return {
      effectiveFps,
      largestGap: Math.max(...gaps),
      reliableForFastPhases: effectiveFps >= 20 && Math.max(...gaps) <= 100
    };
  }, [frames]);

  useEffect(() => {
    if (!playing || !frames.length) return undefined;
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= maxFrame) {
          setPlaying(false);
          return maxFrame;
        }
        return current + 1;
      });
    }, 1000 / TARGET_FPS);
    return () => window.clearInterval(timer);
  }, [frames.length, maxFrame, playing]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    const token = getAccessToken();
    const controller = new AbortController();
    setDraftReady(false);
    setSaveStatus("Loading saved draft…");
    authFetch(`${API_BASE_URL}/admin/temporal-labeling/drafts/${encodeURIComponent(technique.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the saved draft");
        return response.json();
      })
      .then((document) => {
        const draft = document.payload;
        if (document.found && draft) {
          setFrames(Array.isArray(draft.frames) ? draft.frames : []);
          setSegments(Array.isArray(draft.segments) ? draft.segments : []);
          setCustomLabels(Array.isArray(draft.customLabels) ? draft.customLabels : []);
          setCompleted(Array.isArray(draft.completed) ? draft.completed : []);
          setRangeStart(Number(draft.rangeStart) || 0);
          setRangeEnd(Number(draft.rangeEnd) || 0);
          setCursor(Number(draft.cursor) || 0);
          setReviewed(Boolean(draft.reviewed));
          setEditingSessionId(draft.editingSessionId || null);
          setSaveStatus(`Draft restored${document.updated_at ? ` · ${new Date(document.updated_at).toLocaleTimeString()}` : ""}`);
        } else {
          setFrames([]);
          setSegments([]);
          setCustomLabels([]);
          setCompleted([]);
          setReviewed(false);
          setSaveStatus("New draft");
        }
        setDraftReady(true);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setSaveStatus("Autosave unavailable");
          setDraftReady(true);
        }
      });
    return () => controller.abort();
  }, [technique.id]);

  useEffect(() => {
    if (!draftReady || recording) return undefined;
    const timer = window.setTimeout(async () => {
      const token = getAccessToken();
      setSaveStatus("Saving…");
      try {
        const response = await authFetch(
          `${API_BASE_URL}/admin/temporal-labeling/drafts/${encodeURIComponent(technique.id)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              payload: {
                schemaVersion: 1,
                frames,
                segments,
                customLabels,
                completed,
                rangeStart,
                rangeEnd,
                cursor,
                reviewed,
                editingSessionId
              }
            })
          }
        );
        if (!response.ok) throw new Error("Autosave failed");
        const result = await response.json();
        setSaveStatus(`Saved · ${new Date(result.updated_at || Date.now()).toLocaleTimeString()}`);
      } catch {
        setSaveStatus("Autosave failed · changes remain on this page");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    completed, cursor, customLabels, draftReady, editingSessionId, frames, rangeEnd,
    rangeStart, recording, reviewed, segments, technique.id
  ]);

  const captureFrame = useCallback((sample) => {
    if (!recordingRef.current) return;
    const now = performance.now();
    if (now - lastCapturedAtRef.current < 1000 / TARGET_FPS - 2) return;
    lastCapturedAtRef.current = now;
    frameBufferRef.current.push({
      t: Math.round(now - startedAtRef.current),
      p: compactPoints(sample.filteredPose || sample.pose),
      op: compactPoints(sample.observedPose),
      wp: compactPoints(sample.measurementPose),
      a: sample.angles || {},
      me: Number(sample.motionEnergy || 0),
      tc: Number(sample.trackingConfidence || 0)
    });
  }, []);

  const startRecording = () => {
    frameBufferRef.current = [];
    setFrames([]);
    setSegments([]);
    setReviewed(false);
    startedAtRef.current = performance.now();
    lastCapturedAtRef.current = 0;
    setRecording(true);
    setStatus("Recording only this technique attempt. Press Stop when the attempt ends.");
  };

  const stopRecording = () => {
    recordingRef.current = false;
    setRecording(false);
    setCameraEnabled(false);
    const captured = enrichFramesWithPhysics(
      [...frameBufferRef.current],
      trackingPackage?.manifest?.default_side || "left"
    );
    setFrames(captured);
    if (captured.length) {
      setSegments([{
        start_frame: 0,
        end_frame: captured.length - 1,
        state: "__UNKNOWN__",
        rep: 1
      }]);
      setRangeStart(0);
      setRangeEnd(captured.length - 1);
      setCursor(0);
      setStatus(`Captured ${captured.length} frames. Select ranges and label them manually.`);
    } else {
      setStatus("No pose frames were captured. Check camera visibility and record again.");
    }
  };

  const applyLabel = () => {
    const start = Math.min(rangeStart, rangeEnd);
    const end = Math.max(rangeStart, rangeEnd);
    setSegments((current) => applyRangeLabel(current, start, end, selectedState, Number(rep) || null));
    setCursor(start);
    setReviewed(false);
    setStatus(`Applied ${selectedState} to frames ${start}–${end}.`);
  };

  const normalizeLabel = (value) =>
    value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const addCustomLabel = () => {
    const label = normalizeLabel(newLabel);
    if (!label || stateNames.includes(label)) {
      setStatus(label ? "That label already exists." : "Enter a valid label name.");
      return;
    }
    setCustomLabels((labels) => [...labels, label]);
    setSelectedState(label);
    setNewLabel("");
    setStatus(`Added custom label ${label}.`);
  };

  const renameCustomLabel = (oldLabel, value) => {
    const label = normalizeLabel(value);
    if (!label || (stateNames.includes(label) && label !== oldLabel)) return;
    setCustomLabels((labels) => labels.map((item) => item === oldLabel ? label : item));
    setSegments((items) => items.map((item) =>
      item.state === oldLabel ? { ...item, state: label } : item
    ));
    setCompleted((sessions) => sessions.map((session) => ({
      ...session,
      manual_annotation: {
        ...session.manual_annotation,
        segments: session.manual_annotation.segments.map((item) =>
          item.state === oldLabel ? { ...item, state: label } : item
        )
      }
    })));
    if (selectedState === oldLabel) setSelectedState(label);
  };

  const removeCustomLabel = (label) => {
    setCustomLabels((labels) => labels.filter((item) => item !== label));
    setSegments((items) => mergeSegments(items.map((item) =>
      item.state === label ? { ...item, state: "__UNKNOWN__" } : item
    )));
    setCompleted((sessions) => sessions.map((session) => ({
      ...session,
      manual_annotation: {
        ...session.manual_annotation,
        segments: mergeSegments(session.manual_annotation.segments.map((item) =>
          item.state === label ? { ...item, state: "__UNKNOWN__" } : item
        ))
      }
    })));
    if (selectedState === label) setSelectedState("__UNKNOWN__");
    setReviewed(false);
    setStatus(`Removed ${label}; its ranges were changed to __UNKNOWN__ for review.`);
  };

  const finishRecording = () => {
    const id = editingSessionId || crypto.randomUUID();
    const durationMs = frames.at(-1)?.t || 0;
    const finishedSession = {
      schema_version: "1.0",
      session_id: id,
      source: "admin_manual_capture",
      technique_id: technique.id,
      technique_name: technique.name,
      tracking_package: technique.trackingPackage,
      tracking_version: technique.trackingVersion,
      created_at: new Date().toISOString(),
      duration_ms: durationMs,
      nominal_fps: TARGET_FPS,
      capture: {
        effective_fps: frames.length > 1
          ? Number(((frames.length - 1) * 1000 / Math.max(durationMs, 1)).toFixed(2))
          : 0,
        complete_frame_grid: false
      },
      provenance: {
        origin: "real",
        observation: "mediapipe_live",
        human_verified: true
      },
      frames,
      manual_annotation: {
        status: "human_verified",
        reviewed_at: new Date().toISOString(),
        segments
      }
    };
    setCompleted((current) => editingSessionId
      ? current.map((session) => session.session_id === editingSessionId ? finishedSession : session)
      : [...current, finishedSession]
    );
    frameBufferRef.current = [];
    setFrames([]);
    setSegments([]);
    setReviewed(false);
    setEditingSessionId(null);
    setStatus(editingSessionId
      ? "Session changes saved. It is ready to export."
      : "Recording added to the session queue. Enable the camera for the next session."
    );
  };

  const datasetPayload = (sessions) => ({
      schema_version: "1.0",
      dataset_type: "human_verified_standalone_captures",
      label_authority: "manual_verified",
      exported_at: new Date().toISOString(),
      technique: {
        id: technique.id,
        name: technique.name,
        tracking_package: technique.trackingPackage,
        tracking_version: technique.trackingVersion,
        labels: {
          trainable_states: trackingPackage?.stateNames || [],
          context_labels: [...CONTEXT_LABELS, ...transitionLabels],
          custom_labels: customLabels
        },
        steps: technique.steps
      },
      sessions
  });

  const exportDataset = () => {
    downloadJson(
      datasetPayload(completed),
      `${slugify(technique.name)}-manual-dataset-${Date.now()}.json`
    );
  };

  const reviewSession = (session) => {
    if (recording) return;
    setCameraEnabled(false);
    setPlaying(false);
    setEditingSessionId(session.session_id);
    setFrames(session.frames);
    setSegments(session.manual_annotation.segments);
    setRangeStart(0);
    setRangeEnd(Math.max(0, session.frames.length - 1));
    setCursor(0);
    setReviewed(false);
    setStatus("Reviewing an existing session. Edit labels, verify the timeline, then save changes.");
  };

  const inspectModel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const metadata = JSON.parse(await file.text());
      const result = validateTemporalModelMetadata(metadata, trackingPackage);
      setModelStatus(result.valid
        ? `Compatible model: ${metadata.model_version || file.name}`
        : `Model rejected: ${result.errors.join("; ")}`
      );
    } catch {
      setModelStatus("Model rejected: metadata is not valid JSON.");
    }
  };

  if (!technique) return <main className="temporal-lab">No trackable techniques are available.</main>;

  return (
    <main className="temporal-lab">
      <header className="temporal-lab__hero">
        <div>
          <p className="eyebrow">Admin · Temporal learning</p>
          <h1>Standalone recording & manual labeling</h1>
          <p>Record clean attempts here, label timeline ranges yourself, then export a verified dataset for Colab.</p>
        </div>
        <Link className="secondary-button" to="/admin-studio">Back to Admin Studio</Link>
      </header>
      <nav className="temporal-workflow" aria-label="Data preparation workflow">
        <span className={!frames.length ? "is-active" : ""}>1. Record</span>
        <span className={frames.length ? "is-active" : ""}>2. Label & review</span>
        <span className={completed.length ? "is-active" : ""}>3. Manage sessions</span>
        <span>4. Export</span>
      </nav>

      <section className="temporal-lab__grid">
        <article className="temporal-lab__panel">
          <div className="temporal-lab__panel-heading">
            <div>
              <p className="eyebrow">1 · Configure</p>
              <h2>Technique definition</h2>
            </div>
          </div>
          <label>
            Technique
            <select
              value={technique.id}
              disabled={recording || frames.length > 0 || completed.length > 0}
              onChange={(event) => setTechniqueId(event.target.value)}
            >
              {techniques.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <details className="temporal-compact-details">
            <summary>Technique order and label guide</summary>
            <div className="temporal-expected-order">
              <p>Normal order. Use an exception label only when the movement breaks this path.</p>
              <ol>
                {expectedSequence.map((state, index) => (
                  <li className={state.includes("_TO_") ? "is-transition" : ""} key={`${state}-${index}`}>
                    <span>{index + 1}</span>
                    <strong>{state.replaceAll("_", " ")}</strong>
                  </li>
                ))}
              </ol>
              <strong>Use when needed</strong>
              <ol>
                {exceptionLabels.map((state) => (
                  <li className="is-exception" key={state} title={describeLabel(state)}>
                    <span>!</span>
                    <strong>{state.replaceAll("_", " ")}</strong>
                  </li>
                ))}
              </ol>
            </div>
          </details>
          <details className="temporal-compact-details">
            <summary>Add or edit custom labels</summary>
            <div className="temporal-label-manager">
            <div className="temporal-label-manager__add">
              <input
                value={newLabel}
                placeholder="Example: FALSE_START"
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomLabel();
                  }
                }}
              />
              <button type="button" className="secondary-button" onClick={addCustomLabel}>
                Add label
              </button>
            </div>
            {customLabels.map((label) => (
              <div className="temporal-label-manager__row" key={label}>
                <input
                  defaultValue={label}
                  aria-label={`Edit ${label}`}
                  onBlur={(event) => renameCustomLabel(label, event.target.value)}
                />
                <button type="button" className="secondary-button" onClick={() => removeCustomLabel(label)}>
                  Remove
                </button>
              </div>
            ))}
            <small>Removing a used label changes its ranges to __UNKNOWN__ so they must be checked again.</small>
            </div>
          </details>
        </article>

        <article className="temporal-lab__panel temporal-recorder">
          <div className="temporal-lab__panel-heading">
            <div>
              <p className="eyebrow">2 · Capture</p>
              <h2>Direct camera recorder</h2>
            </div>
            <span className={recording ? "temporal-recorder__live" : ""}>
              {recording ? "● Recording" : `${frames.length} frames`}
            </span>
          </div>
          <p className="temporal-recorder__autosave">{saveStatus}</p>
          <div className="temporal-recorder__camera">
            {cameraEnabled ? (
              <SkeletonCanvas
                enableCoach={false}
                enableAwareness={false}
                trackingSessionActive={false}
                skeletonLayers={{ expected: false }}
                measurementParts={measurementParts}
                requiredParts={measurementParts}
                performanceProfile="admin"
                performanceMode="quality"
                capturePoseOnly
                onLandmarkFrame={captureFrame}
              />
            ) : (
              <button type="button" className="primary-button" onClick={() => setCameraEnabled(true)}>
                Enable camera
              </button>
            )}
          </div>
          <div className="temporal-lab__actions">
            <button
              type="button"
              className="primary-button"
              disabled={!cameraEnabled || recording || frames.length > 0}
              onClick={startRecording}
            >
              Start recording
            </button>
            <button type="button" className="secondary-button" disabled={!recording} onClick={stopRecording}>
              Stop & label
            </button>
            <button type="button" className="secondary-button"
              disabled={!cameraEnabled || recording}
              onClick={() => {
                setCameraEnabled(false);
                setStatus("Camera is off. Existing recording data is still safe.");
              }}>
              Camera off
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={recording || !frames.length}
              onClick={() => {
                setFrames([]);
                setSegments([]);
                frameBufferRef.current = [];
                setEditingSessionId(null);
                setStatus("Recording discarded. Start a new session when ready.");
              }}
            >
              Discard
            </button>
          </div>
          <p className="temporal-lab__status">{status}</p>
        </article>
      </section>

      <section className="temporal-lab__panel">
        <div className="temporal-lab__panel-heading">
          <div>
            <p className="eyebrow">3 · Label</p>
            <h2>{editingSessionId ? "Review and edit session" : "Label the recorded sequence"}</h2>
          </div>
        </div>
        <StateTimeline
          frameCount={frames.length}
          segments={segments}
          cursor={cursor}
          onSelect={(segment) => {
            setRangeStart(segment.start_frame);
            setRangeEnd(segment.end_frame);
            setCursor(segment.start_frame);
            setSelectedState(segment.state);
            setRep(segment.rep || 1);
          }}
        />
        {captureQuality && (
          <div className={`temporal-capture-quality ${captureQuality.reliableForFastPhases ? "is-good" : "is-warning"}`}>
            <strong>
              {captureQuality.reliableForFastPhases ? "Capture timing is suitable" : "Fast phases may be between sampled frames"}
            </strong>
            <span>
              Effective {captureQuality.effectiveFps.toFixed(1)} FPS · largest gap {Math.round(captureQuality.largestGap)} ms
            </span>
            {!captureQuality.reliableForFastPhases && (
              <small>
                Do not invent an observed frame. Label visible states; the ordered decoder may infer a skipped latent phase from neighboring states and physics with reduced confidence.
              </small>
            )}
          </div>
        )}
        {frames.length > 0 && (
          <div className="temporal-recorder__label-workspace">
            <div>
              <SkeletonPreview frame={frames[cursor]} />
              <div className="temporal-recorder__playback">
                <button type="button" className="secondary-button" onClick={() => setCursor(Math.max(0, cursor - 1))}>−1 frame</button>
                <button type="button" className="primary-button" onClick={() => {
                  if (cursor >= maxFrame) setCursor(0);
                  setPlaying((value) => !value);
                }}>{playing ? "Pause" : "Play"}</button>
                <button type="button" className="secondary-button" onClick={() => setCursor(Math.min(maxFrame, cursor + 1))}>+1 frame</button>
              </div>
              <label>
                Selected frame: {cursor} · {Math.round(frames[cursor]?.t || 0)} ms
                <input type="range" min="0" max={maxFrame} value={cursor}
                  onChange={(event) => {
                    setPlaying(false);
                    setCursor(Number(event.target.value));
                  }} />
              </label>
            </div>
            <div className="temporal-recorder__label-controls">
              <label>
                Range start: {rangeStart}
                <input type="range" min="0" max={maxFrame} value={rangeStart}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRangeStart(value);
                    setCursor(value);
                  }} />
              </label>
              <label>
                Range end: {rangeEnd}
                <input type="range" min="0" max={maxFrame} value={rangeEnd}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRangeEnd(value);
                    setCursor(value);
                  }} />
              </label>
              <label>
                Label
                <select value={selectedState} onChange={(event) => setSelectedState(event.target.value)}>
                  {stateNames.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
                <small className="temporal-recorder__label-meaning">
                  {describeLabel(selectedState)}
                </small>
              </label>
              <label>
                Rep
                <input type="number" min="1" value={rep} onChange={(event) => setRep(event.target.value)} />
              </label>
              <button type="button" className="primary-button" onClick={applyLabel}>Apply label to range</button>
            </div>
          </div>
        )}
        <label className="temporal-recorder__review">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={!frames.length}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          I reviewed the full timeline and these are manual ground-truth labels.
        </label>
        <button type="button" className="primary-button" disabled={!reviewed || !frames.length} onClick={finishRecording}>
          {editingSessionId ? "Save reviewed changes" : "Approve and add session"}
        </button>
      </section>

      <section className="temporal-lab__panel">
        <div className="temporal-lab__panel-heading">
          <div>
            <p className="eyebrow">4 · Export</p>
            <h2>Recorded sessions</h2>
          </div>
          <strong>{completed.length} sessions</strong>
        </div>
        <div className="temporal-lab__sessions">
          {completed.map((session, index) => (
            <article key={session.session_id}>
              <div><strong>Session {index + 1}</strong><time>{session.frames.length} frames</time></div>
              <span className="is-human_verified">Human verified</span>
              <div className="temporal-session-actions">
              <button type="button" className="secondary-button" onClick={() => reviewSession(session)}>
                Review / edit
              </button>
              <button type="button" className="secondary-button" onClick={() =>
                downloadJson(
                  datasetPayload([session]),
                  `${slugify(technique.name)}-session-${index + 1}.json`
                )}>
                Export
              </button>
              <button type="button" className="secondary-button"
                onClick={() => setCompleted((items) => items.filter((item) => item.session_id !== session.session_id))}>
                Delete
              </button>
              </div>
            </article>
          ))}
        </div>
        <div className="temporal-lab__actions">
          <button type="button" className="primary-button" disabled={!completed.length} onClick={exportDataset}>
            Export JSON for Colab
          </button>
          <button type="button" className="secondary-button" disabled={!completed.length}
            onClick={() => setCompleted([])}>
            Clear exported queue
          </button>
        </div>
      </section>

      <section className="temporal-lab__panel">
        <p className="eyebrow">5 · Return model</p>
        <h2>Check trained model metadata</h2>
        <input type="file" accept=".json,application/json" onChange={inspectModel} />
        {modelStatus && <p className="temporal-lab__status">{modelStatus}</p>}
      </section>
    </main>
  );
}
