import { useCallback, useEffect, useRef, useState } from "react";
import DataLayersPanel from "../components/DataLayersPanel";
import TrainMode from "../modes/TrainMode";
import useBodyCalibration from "../hooks/useBodyCalibration";
import { slugify } from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";
import { buildCoachContextPacket } from "../situationAwareness/buildCoachContextPacket";
import { STUDIO_PERFORMANCE_MODES } from "../performance/studioPerformanceConfig";
import { createAwarenessStream } from "../services/awarenessStream";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import { deliverAwarenessActions } from "../services/awarenessActions";
import { buildAwarenessPerceptionEnvelope } from "../perception/awarenessEnvelope";

const label = (value, fallback = "Waiting") => value ? String(value).replaceAll("_", " ") : fallback;
const percent = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "--";
const decimal = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--";
function ConsoleSection({ id, title, meta, defaultOpen = true, children }) {
  return <details className="awareness-console-section" id={id} open={defaultOpen}><summary><strong>{title}</strong><span>{meta}</span><b>⌄</b></summary><div className="awareness-console-section__body">{children}</div></details>;
}
function Value({ name, children }) { return <div className="awareness-value"><span>{name}</span><strong>{children ?? "--"}</strong></div>; }
function LayerCard({ code, title, horizon, children }) { return <article className="awareness-layer-card"><header><span>{code}</span><div><strong>{title}</strong><small>{horizon}</small></div></header>{children}</article>; }
function SensorRow({ name, status, active }) { return <li><span>{name}</span><strong className={active ? "is-active" : ""}>{status}</strong></li>; }
function EmptyState({ children }) { return <p className="awareness-console-empty">{children}</p>; }

export default function AdminAwareness() {
  const { catalog } = useCatalog();
  const techniques = catalog.flatMap((category) => category.subcategories.flatMap((subcategory) =>
    subcategory.techniques.map((technique) => ({ ...technique, categoryName: category.category, subcategoryName: subcategory.name, categorySlug: slugify(category.category), subcategorySlug: slugify(subcategory.name) }))));
  const techniqueGroups = catalog.map((category) => ({
    name: category.category,
    items: techniques.filter((technique) => technique.categoryName === category.category)
  })).filter((group) => group.items.length);
  const defaultTechnique = techniques.find((item) => item.name.toLowerCase() === "jab") || techniques[0];
  const [techniqueId, setTechniqueId] = useState(String(defaultTechnique?.id || ""));
  const [diagnostics, setDiagnostics] = useState({});
  const [displayMirrored, setDisplayMirrored] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [textEnabled, setTextEnabled] = useState(true);
  const [performanceMode, setPerformanceMode] = useState("auto");
  const [awarenessGoal, setAwarenessGoal] = useState("improve_user_technique");
  const [skeletonLayers, setSkeletonLayers] = useState({ level1: false, onnx: false });
  const [predictionStatus, setPredictionStatus] = useState({ status: "idle", ready: false, error: null });
  const [events, setEvents] = useState([]);
  const [frozen, setFrozen] = useState(false);
  const [backendStatus, setBackendStatus] = useState("connecting");
  const [backendSnapshot, setBackendSnapshot] = useState(null);
  const [knowledgeProfile, setKnowledgeProfile] = useState(null);
  const [knowledgeProfiles, setKnowledgeProfiles] = useState([]);
  const [knowledgeVersionDraft, setKnowledgeVersionDraft] = useState("1.1.0");
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [decisionEvaluations, setDecisionEvaluations] = useState([]);
  const [perceptionModules, setPerceptionModules] = useState([]);
  const [actionDelivery, setActionDelivery] = useState([]);
  const [actionDeliveryHistory, setActionDeliveryHistory] = useState([]);
  const [longTermMemory, setLongTermMemory] = useState({ objects: [], relationships: [] });
  const previousRef = useRef({});
  const frozenRef = useRef(false);
  const awarenessStreamRef = useRef(null);
  const awarenessSequenceRef = useRef(0);
  const lastAwarenessPublishRef = useRef(0);
  const awarenessRunIdRef = useRef("");
  const evaluationFetchRef = useRef(0);
  const deliveredRevisionRef = useRef(0);
  const bodyCalibration = useBodyCalibration();
  const selected = techniques.find((item) => String(item.id) === techniqueId) || defaultTechnique;
  const handleDiagnosticsUpdate = useCallback((next) => {
    if (!frozenRef.current) setDiagnostics(next);
  }, []);
  const toggleFrozen = () => {
    frozenRef.current = !frozenRef.current;
    setFrozen(frozenRef.current);
  };
  const selectTechnique = (nextId) => {
    setTechniqueId(nextId);
    setDiagnostics({});
    setEvents([]);
    previousRef.current = {};
    frozenRef.current = false;
    setFrozen(false);
  };
  const l1 = diagnostics.level1State || {};
  const motion = l1.motion_context || {};
  const action = diagnostics.level2State?.action_context || {};
  const session = diagnostics.level3State?.session_context || {};
  const user = diagnostics.level4State?.user_context || {};
  const situation = diagnostics.situationAwarenessState?.situation_context || {};
  const tracking = l1.tracking || {};
  const live = Boolean(diagnostics.awareness?.active && l1.timestamp);
  const coachPacket = buildCoachContextPacket({ level1State: diagnostics.level1State, level2State: diagnostics.level2State, level3State: diagnostics.level3State, level4State: diagnostics.level4State, situationAwarenessState: diagnostics.situationAwarenessState, mode: "train", techniqueName: selected?.name, currentStepId: action.step_id, currentStepName: action.step_state });

  useEffect(() => {
    const current = { live, phase: action.step_state, issue: action.likely_mistake?.issue, situation: situation.situation_state, feedback: situation.feedback_decision?.message };
    const names = { live: live ? "User detected by MediaPipe" : null, phase: action.step_state ? `${label(action.step_state)} phase detected` : null, issue: action.likely_mistake ? `${label(action.likely_mistake.body_part)}: ${label(action.likely_mistake.issue)}` : null, situation: situation.situation_state ? `Awareness updated → ${label(situation.situation_state)}` : null, feedback: situation.feedback_decision?.message ? `Feedback generated: ${situation.feedback_decision.message}` : null };
    const additions = Object.keys(current).filter((key) => current[key] && current[key] !== previousRef.current[key] && names[key]).map((key, index) => ({ id: `${Date.now()}-${key}`, time: new Date(Date.now() + index).toLocaleTimeString("en-GB", { hour12: false, fractionalSecondDigits: 3 }), text: names[key] }));
    previousRef.current = current;
    if (additions.length) setEvents((items) => [...additions, ...items].slice(0, 24));
  }, [action.likely_mistake, action.step_state, live, situation.feedback_decision?.message, situation.situation_state]);

  const repetitions = session.repetition_summary || {};
  const activeTechnique = user.active_technique || {};
  const attention = situation.attention_target || {};
  const feedback = situation.feedback_decision || {};
  const reasoning = situation.reasoning || {};
  const backendObjects = backendSnapshot?.objects || [];
  const backendRelationships = backendSnapshot?.relationships || [];
  const backendUser = backendObjects.find((item) => item.object_id === "user:primary") || backendObjects.find((item) => item.object_type === "human");
  const backendFloor = backendObjects.find((item) => item.object_type === "floor");
  const backendWall = backendObjects.find((item) => item.object_type === "wall");
  const backendTemporal = backendUser?.state || {};
  const toggleSkeletonLayer = (layer) => setSkeletonLayers((current) => ({ ...current, [layer]: !current[layer] }));
  const layerStatus = [
    ["Perception", diagnostics.awareness?.active],
    ["L1 Motion", diagnostics.level1State],
    ["L2 Action", diagnostics.level2State],
    ["L3 Session", diagnostics.level3State],
    ["L4 User", diagnostics.level4State],
    ["Awareness", diagnostics.situationAwarenessState]
  ];

  useEffect(() => {
    awarenessRunIdRef.current =
      globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stream = createAwarenessStream({
      onSnapshotAck: (snapshot) => {
        setBackendSnapshot(snapshot);
        const now = Date.now();
        if (now - evaluationFetchRef.current >= 2500 && snapshot.session_key) {
          evaluationFetchRef.current = now;
          authFetch(`${API_BASE_URL}/admin/awareness/sessions/${encodeURIComponent(snapshot.session_key)}/evaluations?limit=100`)
            .then((response) => response.ok ? response.json() : [])
            .then(setDecisionEvaluations)
            .catch(() => {});
        }
      },
      onStatus: setBackendStatus
    });
    awarenessStreamRef.current = stream;
    return () => {
      stream.close();
      awarenessStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!backendSnapshot?.revision || deliveredRevisionRef.current >= backendSnapshot.revision) return;
    deliveredRevisionRef.current = backendSnapshot.revision;
    const audioAdapter = voiceEnabled && typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined"
      ? ({ message }) => speechSynthesis.speak(new SpeechSynthesisUtterance(message))
      : null;
    deliverAwarenessActions(backendSnapshot.backend_decision?.actions || [], {
      visual: () => {},
      audio: audioAdapter,
      system: (_command, payload) => {
        if (payload?.pause_training) {
          frozenRef.current = true;
          setFrozen(true);
        }
      },
    }).then(async (deliveries) => {
      setActionDelivery(deliveries);
      if (!deliveries.length || !backendSnapshot.session_key) return;
      const response = await authFetch(
        `${API_BASE_URL}/admin/awareness/sessions/${encodeURIComponent(backendSnapshot.session_key)}/deliveries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: backendSnapshot.revision, deliveries }),
        },
      );
      if (response.ok) setActionDeliveryHistory(await response.json());
    }).catch(() => {});
  }, [backendSnapshot, voiceEnabled]);

  const refreshKnowledge = useCallback(async () => {
    try {
      const [activeResponse, profilesResponse, modulesResponse, memoryResponse] = await Promise.all([
        authFetch(`${API_BASE_URL}/admin/awareness/knowledge`),
        authFetch(`${API_BASE_URL}/admin/awareness/knowledge/profiles`),
        authFetch(`${API_BASE_URL}/admin/awareness/perception/modules`),
        authFetch(`${API_BASE_URL}/admin/awareness/memory`)
      ]);
      if (activeResponse.ok) {
        const active = await activeResponse.json();
        setKnowledgeProfile(active.profile || null);
      }
      if (profilesResponse.ok) setKnowledgeProfiles(await profilesResponse.json());
      if (modulesResponse.ok) setPerceptionModules(await modulesResponse.json());
      if (memoryResponse.ok) setLongTermMemory(await memoryResponse.json());
    } catch {
      setKnowledgeMessage("Knowledge API unavailable");
    }
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(refreshKnowledge, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refreshKnowledge]);

  const perceptionStatus = (key, fallback = "Disabled") => {
    const module = perceptionModules.find((item) => item.key === key);
    if (!module) return fallback;
    if (module.status === "ready") return "Ready";
    if (module.status === "model_missing") return "Model missing";
    return "Disabled";
  };
  const perceptionReady = (key) => perceptionModules.some((item) => item.key === key && item.status === "ready");

  const createKnowledgeDraft = async () => {
    if (!knowledgeProfile || !knowledgeVersionDraft.trim()) return;
    const response = await authFetch(`${API_BASE_URL}/admin/awareness/knowledge/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...knowledgeProfile, version: knowledgeVersionDraft.trim() })
    });
    setKnowledgeMessage(response.ok ? "Draft created" : (await response.json()).detail || "Could not create draft");
    if (response.ok) refreshKnowledge();
  };

  const transitionKnowledge = async (recordId, action) => {
    const response = await authFetch(`${API_BASE_URL}/admin/awareness/knowledge/profiles/${recordId}/${action}`, { method: "POST" });
    setKnowledgeMessage(response.ok ? `Profile ${action === "submit" ? "submitted" : "activated"}` : (await response.json()).detail || "Transition failed");
    if (response.ok) refreshKnowledge();
  };

  const exportMemory = () => {
    const blob = new Blob([JSON.stringify(longTermMemory, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `awareness-memory-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearMemory = async () => {
    if (!window.confirm("Delete all long-term awareness memory for this admin user?")) return;
    const response = await authFetch(`${API_BASE_URL}/admin/awareness/memory`, { method: "DELETE" });
    if (response.ok) {
      setLongTermMemory({ objects: [], relationships: [] });
      setKnowledgeMessage("Long-term awareness memory cleared");
    }
  };

  useEffect(() => {
    if (!diagnostics.level1State || !awarenessRunIdRef.current) return;
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (now - lastAwarenessPublishRef.current < 500) return;
    lastAwarenessPublishRef.current = now;
    awarenessSequenceRef.current += 1;
    awarenessStreamRef.current?.publishPerception(buildAwarenessPerceptionEnvelope({
      diagnostics,
      goalType: awarenessGoal,
      sequence: awarenessSequenceRef.current,
      sessionKey: `admin.${String(selected?.id || "unknown")}.${awarenessRunIdRef.current}`,
      techniqueName: selected?.name,
      metadata: {
        source: "admin-awareness",
        frozen,
        performance_mode: performanceMode
      }
    }));
  }, [awarenessGoal, diagnostics, frozen, live, performanceMode, selected?.id, selected?.name, tracking.confidence]);
  const studioControls = <section className="awareness-studio-controls" aria-label="Studio awareness controls">
    <label><span>Performance</span><select aria-label="Performance mode" value={performanceMode} onChange={(event) => setPerformanceMode(event.target.value)}>{Object.entries(STUDIO_PERFORMANCE_MODES).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select></label>
    <button aria-pressed={voiceEnabled} className={voiceEnabled ? "is-active" : ""} onClick={() => setVoiceEnabled((value) => !value)} type="button">Voice {voiceEnabled ? "On" : "Off"}</button>
    <button aria-pressed={textEnabled} className={textEnabled ? "is-active" : ""} onClick={() => setTextEnabled((value) => !value)} type="button">Text {textEnabled ? "On" : "Off"}</button>
    <button aria-pressed={displayMirrored} className={displayMirrored ? "is-active" : ""} onClick={() => setDisplayMirrored((value) => !value)} type="button">Mirror {displayMirrored ? "On" : "Off"}</button>
    <button aria-pressed={skeletonLayers.level1} className={skeletonLayers.level1 ? "is-yellow" : ""} onClick={() => toggleSkeletonLayer("level1")} type="button">L1 {skeletonLayers.level1 ? "On" : "Off"}</button>
    <button aria-pressed={skeletonLayers.onnx} className={skeletonLayers.onnx ? "is-blue" : ""} onClick={() => toggleSkeletonLayer("onnx")} title={predictionStatus.error || `ACP runtime: ${predictionStatus.status}`} type="button">ACP {skeletonLayers.onnx ? predictionStatus.ready ? "Ready" : predictionStatus.error ? "Error" : "Loading" : "Off"}</button>
    <span className="awareness-studio-controls__spacer" />
    <button aria-pressed={frozen} className={frozen ? "is-frozen" : ""} onClick={toggleFrozen} type="button">{frozen ? "Resume" : "Freeze"}</button>
  </section>;

  return <main className="admin-awareness-page awareness-console">
    <header className="awareness-console-bar">
      <div className="awareness-console-brand"><span className={live ? "is-live" : ""} /><strong>{live ? "LIVE" : "WAITING"}</strong><b>Camera 01</b></div>
      <div className="awareness-console-stat"><span>FPS</span><strong>{tracking.fps || 0}</strong></div><div className="awareness-console-stat"><span>Latency</span><strong>{tracking.fps ? `${Math.round(1000 / tracking.fps)} ms` : "--"}</strong></div>
      <div className={`awareness-console-stat awareness-backend-status is-${backendStatus}`} title={backendSnapshot?.backend_decision?.feedback?.message || "Backend awareness stream"}><span>Backend</span><strong>{label(backendStatus)}{backendSnapshot?.backend_inference?.situation_state ? ` · ${label(backendSnapshot.backend_inference.situation_state)}` : ""}{backendSnapshot?.backend_decision?.command ? ` · ${label(backendSnapshot.backend_decision.command)}` : ""}</strong></div>
      <label className="awareness-technique-select"><span>Technique</span><select aria-label="Technique" value={techniqueId} onChange={(event) => selectTechnique(event.target.value)}>{techniqueGroups.map((group) => <optgroup key={group.name} label={group.name}>{group.items.map((item) => <option key={item.id} value={String(item.id)}>{item.name} · {item.subcategoryName}</option>)}</optgroup>)}</select><small>{techniques.length} available</small></label>
      <label className="awareness-technique-select awareness-goal-select"><span>Goal</span><select aria-label="Awareness goal" value={awarenessGoal} onChange={(event) => setAwarenessGoal(event.target.value)}><option value="improve_user_technique">Improve technique</option><option value="maximize_defense">Maximize defense</option><option value="evaluate_balance">Evaluate balance</option><option value="detect_threat">Detect threat</option></select><small>Drives attention</small></label>
      <div className="awareness-console-stat"><span>Mode</span><strong>Training</strong></div>
    </header>

    <section className="awareness-pipeline-strip" aria-label="Awareness pipeline readiness">
      <div><span>Selected</span><strong>{selected?.name}</strong><small>{selected?.categoryName} / {selected?.subcategoryName} / {selected?.steps?.length || 0} steps</small></div>
      {layerStatus.map(([name, ready]) => <div className={ready ? "is-ready" : ""} key={name}><i /><span>{name}</span><strong>{ready ? frozen ? "Snapshot" : "Live" : "Waiting"}</strong></div>)}
    </section>

    <ConsoleSection id="camera" title="STUDIO TRAIN MODE · WORLD · AWARENESS" meta={live ? "Streaming" : "Camera permission required"}>
      <div className="awareness-console-triad">
        {studioControls}
        <section className="awareness-camera-column"><header><strong>Studio Train Mode · {selected?.name}</strong><span>{selected?.difficulty} · Live feedback</span></header><div className="training-shell training-shell--admin admin-awareness-studio"><TrainMode key={selected?.id} awarenessCompact categorySlug={selected?.categorySlug} subcategorySlug={selected?.subcategorySlug} selectedTechniqueName={selected?.name} displayMirrored={displayMirrored} textEnabled={textEnabled} voiceEnabled={voiceEnabled} isAdminStudio performanceProfile="admin" performanceMode={performanceMode} skeletonLayers={skeletonLayers} bodyCalibration={bodyCalibration} inputSource="live" onDiagnosticsUpdate={handleDiagnosticsUpdate} onPredictionStatus={setPredictionStatus} /></div><ul className="awareness-sensor-list"><SensorRow name="MediaPipe Pose / Hands / Face" status={live ? "✓ Live" : perceptionStatus("human", "Starting")} active={live} /><SensorRow name="YOLO object detection" status={perceptionStatus("objects")} active={perceptionReady("objects")} /><SensorRow name="Scene segmentation" status={perceptionStatus("scene")} active={perceptionReady("scene")} /><SensorRow name="Depth geometry" status={perceptionStatus("geometry")} active={perceptionReady("geometry")} /></ul></section>
        <section className="awareness-world-column">
          <header><strong>World foundation</strong><span>Verified entities only</span></header>
          <div className="awareness-world-graph"><div className={live ? "world-node world-node--user is-live" : "world-node world-node--user"}>User<small>{percent(tracking.confidence)}</small></div><div className="world-node world-node--camera">Camera<small>source</small></div><div className={`world-node world-node--floor ${backendFloor?.verified ? "is-live" : "is-pending"}`}>Floor<small>{backendFloor ? percent(backendFloor.confidence) : "pending"}</small></div><div className={`world-node world-node--wall ${backendWall?.verified ? "is-live" : "is-pending"}`}>Wall<small>{backendWall ? percent(backendWall.confidence) : "pending"}</small></div><i className="world-edge" aria-hidden="true" /></div>
          <p className="awareness-world-note">Floor and camera-field wall regions come from privacy-safe pose-ground geometry. Opponent, weapon, equipment and other-object nodes remain inactive until the future object detector produces evidence.</p>
          <div className="awareness-admin-fill">
            <article className="awareness-admin-card">
              <header><strong>Perception readiness</strong><span>{live ? "1 live" : "Starting"}</span></header>
              <ul className="awareness-admin-status">
                <SensorRow name="Pose / hands / face" status={live ? "Live" : "Starting"} active={live} />
                <SensorRow name="Object detection" status={perceptionStatus("objects")} active={perceptionReady("objects")} />
<SensorRow name="Scene segmentation" status={perceptionStatus("scene")} active={perceptionReady("scene")} />
                <SensorRow name="Depth geometry" status={perceptionStatus("geometry")} active={perceptionReady("geometry")} />
              </ul>
            </article>
            <article className="awareness-admin-card">
              <header><strong>Verified world facts</strong><span>{live ? "Updated live" : "No evidence"}</span></header>
              <div className="awareness-admin-values">
                <Value name="Tracked entities">{live ? 1 : 0}</Value>
                <Value name="Source">Camera 01</Value>
                <Value name="User confidence">{percent(tracking.confidence)}</Value>
                <Value name="Relations">0 verified</Value>
              </div>
              <p>Only evidence produced by an active detector is promoted into the world model.</p>
            </article>
          </div>
          <section className="awareness-embedded-panel awareness-embedded-layers">
            <header><strong>Selected object · User</strong><span>{live ? "Tracked" : "Waiting"}</span></header>
            <div className="awareness-layer-grid">
              <LayerCard code="L1" title="Motion" horizon="now → +100 ms"><Value name="Tracking">{percent(tracking.confidence)}</Value><Value name="FPS">{tracking.fps || "--"}</Value><Value name="Angles">{Object.keys(motion.angles_deg || {}).length}</Value><Value name="Prediction">{percent(motion.prediction_confidence)}</Value></LayerCard>
              <LayerCard code="L2" title="Action" horizon="action → +1 sec"><Value name="Action">{label(action.step_state)}</Value><Value name="Phase">{label(action.temporal_segmentation?.motion_phase)}</Value><Value name="Confidence">{percent(action.step_probability)}</Value><Value name="Next">{label(action.next_step_prediction)}</Value></LayerCard>
              <LayerCard code="L3" title="Session" horizon="repetitions → minutes"><Value name="Reps">{repetitions.repetitions_completed || 0}</Value><Value name="Correct">{repetitions.correct_repetitions || 0}</Value><Value name="Consistency">{percent(session.consistency_score)}</Value><Value name="Pattern">{label(session.repeated_mistake?.issue, "Collecting")}</Value></LayerCard>
              <LayerCard code="L4" title="Evolution" horizon="sessions → long term"><Value name="Skill">{percent(activeTechnique.mastery_score)}</Value><Value name="Best">{percent(activeTechnique.best_mastery_score)}</Value><Value name="Trend">{label(activeTechnique.learning_trend)}</Value><Value name="Weakness">{label(user.top_weakness?.issue, "None yet")}</Value></LayerCard>
            </div>
          </section>
        </section>
        <section className="awareness-current-column">
          <header><strong>Current A(t)</strong><span>{label(situation.situation_state)}</span></header>
          <div className="awareness-score-stack"><Value name="Mistake risk">{percent(action.mistake_risk)}</Value><Value name="Fatigue risk">{percent(session.fatigue_risk)}</Value><Value name="Tracking">{percent(tracking.confidence)}</Value><Value name="Decision confidence">{percent(reasoning.decision_score)}</Value></div>
          <blockquote>{feedback.message || "Waiting for sufficient motion evidence to form current awareness."}</blockquote>
          <div className="awareness-attention"><span>Attention</span><strong>{label(attention.body_part || attention.layer)}</strong><small>{label(attention.issue, "No supported issue")}</small></div>
          <details><summary>Why?</summary><pre>{JSON.stringify(reasoning, null, 2)}</pre></details>
          <section className="awareness-decision-comparison">
            <header><strong>Client ↔ Backend</strong><span>{backendSnapshot?.decision_comparison?.comparable ? "Comparable" : "Collecting"}</span></header>
            <div>
              <Value name="Client state">{label(backendSnapshot?.decision_comparison?.client?.situation_state)}</Value>
              <Value name="Backend state">{label(backendSnapshot?.decision_comparison?.backend?.situation_state)}</Value>
              <Value name="State agreement">{backendSnapshot?.decision_comparison?.agreement?.state == null ? "Pending" : backendSnapshot.decision_comparison.agreement.state ? "Match" : "Review"}</Value>
              <Value name="Command agreement">{backendSnapshot?.decision_comparison?.agreement?.command == null ? "Pending" : backendSnapshot.decision_comparison.agreement.command ? "Match" : "Review"}</Value>
              <Value name="Backend confidence">{percent(backendSnapshot?.decision_comparison?.backend?.confidence)}</Value>
              <Value name="Knowledge">{backendSnapshot?.world_model?.knowledge?.version ? `v${backendSnapshot.world_model.knowledge.version}` : "Pending"}</Value>
              <Value name="Object L1">{label(backendTemporal.l1?.current_state, "Collecting")}</Value>
              <Value name="Object L2">{label(backendTemporal.l2?.action, "Collecting")}</Value>
              <Value name="Object L3">{label(backendTemporal.l3?.behaviour, "Collecting")}</Value>
              <Value name="Object L4">{label(backendTemporal.l4?.evolution, "Collecting")}</Value>
              <Value name="Previous A(t)">{label(backendSnapshot?.backend_inference?.previous_state, "First frame")}</Value>
              <Value name="Utility choice">{label(backendSnapshot?.backend_decision?.utility?.selected, "Collecting")}</Value>
              <Value name="Backend latency">{backendSnapshot?.latency?.processing_ms == null ? "--" : `${backendSnapshot.latency.processing_ms} ms`}</Value>
              <Value name="Latency budget">{backendSnapshot?.latency?.within_budget == null ? "Pending" : backendSnapshot.latency.within_budget ? "Within budget" : "Over budget"}</Value>
              <Value name="Action delivery">{actionDelivery.length ? `${actionDelivery.filter((item) => item.status === "delivered").length}/${actionDelivery.length} delivered` : "Pending"}</Value>
            </div>
          </section>
          <div className="awareness-admin-fill awareness-admin-fill--audit">
            <article className="awareness-admin-card">
              <header><strong>Decision audit</strong><span>{feedback.type ? label(feedback.type) : "Observing"}</span></header>
              <div className="awareness-admin-values">
                <Value name="Next command">{label(situation.next_action?.command, "Observe")}</Value>
                <Value name="Feedback timing">{label(feedback.timing, "Evidence gated")}</Value>
                <Value name="Speak">{feedback.should_speak ? "Yes" : "No"}</Value>
                <Value name="Pause training">{situation.next_action?.pause_training ? "Yes" : "No"}</Value>
              </div>
            </article>
            <article className="awareness-admin-card">
              <header><strong>Forecast gates</strong><span>{action.forecast_awareness?.trusted ? "Trusted" : "Gated"}</span></header>
              <div className="awareness-admin-values">
                <Value name="Motion prediction">{percent(motion.prediction_confidence)}</Value>
                <Value name="Future risk">{label(action.forecast_awareness?.likely_mistake?.issue, "None trusted")}</Value>
                <Value name="Session pattern">{label(session.repeated_mistake?.issue, "Collecting")}</Value>
                <Value name="Snapshot">{frozen ? "Frozen" : "Live"}</Value>
              </div>
            </article>
          </div>
          <section className="awareness-embedded-panel">
            <header><strong>Prediction timeline</strong><span>{action.forecast_awareness?.trusted ? "Trusted" : "Confidence gated"}</span></header>
            <div className="awareness-prediction-line awareness-prediction-line--compact"><article><i /><span>NOW</span><strong>{label(situation.situation_state, "Observing")}</strong></article><article><i /><span>+100 ms</span><strong>{motion.prediction_confidence ? `Motion · ${percent(motion.prediction_confidence)}` : "Collecting"}</strong></article><article><i /><span>+1 sec</span><strong>{action.forecast_awareness?.trusted ? label(action.forecast_awareness?.likely_mistake?.issue, "Trusted") : "Gated"}</strong></article><article><i /><span>SESSION</span><strong>{label(session.recommendation, "Collecting")}</strong></article></div>
          </section>
          <section className="awareness-embedded-panel">
            <header><strong>Reasoning decision</strong><span>{feedback.type ? label(feedback.type) : "Waiting"}</span></header>
            <div className="awareness-admin-values"><Value name="Prediction">{action.forecast_awareness?.trusted ? label(action.forecast_awareness?.likely_mistake?.issue, "Trusted forecast") : "No trusted risk"}</Value><Value name="Decision">{label(situation.next_action?.command, "Observe")}</Value><Value name="Priority">{percent(situation.agent_context?.priority)}</Value><Value name="Evidence">{reasoning.decision_score ? percent(reasoning.decision_score) : "Collecting"}</Value></div>
            <p className="awareness-embedded-message">{feedback.message || "Waiting for supported evidence before issuing feedback."}</p>
          </section>
          <section className="awareness-embedded-panel awareness-embedded-events">
            <header><strong>Recent awareness events</strong><span>{events.length} captured</span></header>
            <div className="awareness-event-list">{events.length ? events.slice(0, 6).map((event) => <div key={event.id}><time>{event.time}</time><i /><span>{event.text}</span></div>) : <EmptyState>Live state changes will appear here.</EmptyState>}</div>
          </section>
        </section>
      </div>
    </ConsoleSection>

    <ConsoleSection id="knowledge-governance" title="KNOWLEDGE GOVERNANCE · DECISION EVALUATION" meta={`${knowledgeProfiles.length} profiles · ${decisionEvaluations.length} evaluations`} defaultOpen={false}>
      <div className="awareness-governance-grid">
        <section className="awareness-governance-card">
          <header><strong>Active knowledge</strong><span>{knowledgeProfile ? `${knowledgeProfile.profile_id} · v${knowledgeProfile.version}` : "Loading"}</span></header>
          <div className="awareness-knowledge-thresholds">{knowledgeProfile ? Object.entries(knowledgeProfile.thresholds || {}).map(([name, value]) => <Value key={name} name={label(name)}>{String(value)}</Value>) : <EmptyState>Knowledge profile unavailable.</EmptyState>}</div>
          <div className="awareness-governance-actions"><input aria-label="New knowledge version" value={knowledgeVersionDraft} onChange={(event) => setKnowledgeVersionDraft(event.target.value)} /><button type="button" onClick={createKnowledgeDraft}>Create draft from active</button><button type="button" onClick={refreshKnowledge}>Refresh</button></div>
          {knowledgeMessage ? <p className="awareness-governance-message">{knowledgeMessage}</p> : null}
        </section>
        <section className="awareness-governance-card">
          <header><strong>Review workflow</strong><span>Draft → Review → Active</span></header>
          <div className="awareness-profile-list">{knowledgeProfiles.length ? knowledgeProfiles.map((profile) => <article key={profile.id}><div><strong>{profile.profile_id}</strong><span>v{profile.version} · {label(profile.status)}</span></div>{profile.status === "draft" ? <button type="button" onClick={() => transitionKnowledge(profile.id, "submit")}>Submit</button> : null}{profile.status === "in_review" ? <button type="button" onClick={() => transitionKnowledge(profile.id, "activate")}>Activate</button> : null}</article>) : <EmptyState>No persisted profiles. The bundled profile remains active.</EmptyState>}</div>
        </section>
        <section className="awareness-governance-card awareness-governance-card--evaluations">
          <header><strong>Decision evaluation history</strong><span>{backendSnapshot?.session_key || "Waiting for session"}</span></header>
          <div className="awareness-evaluation-summary"><Value name="State matches">{decisionEvaluations.filter((item) => item.state_agreement === true).length}</Value><Value name="State reviews">{decisionEvaluations.filter((item) => item.state_agreement === false).length}</Value><Value name="Command matches">{decisionEvaluations.filter((item) => item.command_agreement === true).length}</Value><Value name="Average confidence">{decisionEvaluations.length ? percent(decisionEvaluations.reduce((sum, item) => sum + Number(item.backend_confidence || 0), 0) / decisionEvaluations.length) : "--"}</Value></div>
          <div className="awareness-evaluation-list">{decisionEvaluations.length ? decisionEvaluations.map((item) => <article key={item.id}><span>r{item.revision}</span><strong>{label(item.client_state)} → {label(item.backend_state)}</strong><small>{item.state_agreement == null ? "Pending" : item.state_agreement ? "State match" : "Review state"} · {percent(item.backend_confidence)} · K v{item.knowledge_version}</small></article>) : <EmptyState>Meaningful client/backend transitions will appear during the live session.</EmptyState>}</div>
        </section>
        <section className="awareness-governance-card">
          <header><strong>Long-term memory</strong><span>{longTermMemory.objects?.length || 0} objects · {longTermMemory.relationships?.length || 0} relations</span></header>
          <div className="awareness-evaluation-summary"><Value name="Observations">{(longTermMemory.objects || []).reduce((sum, item) => sum + Number(item.lifetime_observations || 0), 0)}</Value><Value name="Sessions">{new Set((longTermMemory.objects || []).flatMap((item) => item.sessions || [])).size}</Value><Value name="Delivery records">{actionDeliveryHistory.length}</Value><Value name="Memory confidence">{longTermMemory.objects?.length ? percent(longTermMemory.objects.reduce((sum, item) => sum + Number(item.l4?.memory_confidence || 0), 0) / longTermMemory.objects.length) : "--"}</Value></div>
          <div className="awareness-governance-actions"><button type="button" onClick={exportMemory}>Export memory</button><button type="button" onClick={clearMemory}>Clear memory</button><button type="button" onClick={refreshKnowledge}>Refresh</button></div>
        </section>
      </div>
    </ConsoleSection>

    <ConsoleSection id="objects" title="DETECTED OBJECTS" meta={`${backendObjects.filter((item) => item.verified).length} verified`}><div className="awareness-object-table" role="table"><div role="row" className="is-heading"><span>Object</span><span>Detector</span><span>Confidence</span><span>Priority</span><span>Current state</span><span>Action</span></div>{backendObjects.length ? backendObjects.map((item) => <div role="row" key={item.object_id}><strong>{label(item.object_type)}</strong><span>{label(item.source)}</span><span>{percent(item.confidence)}</span><span>{decimal(backendSnapshot?.attention?.objects?.[item.object_id]?.priority)}</span><span>{label(item.state?.l2?.action, item.verified ? "Active" : "Unverified")}</span><a href="#selected-object">Inspect</a></div>) : <EmptyState>No verified entities. Start the camera and enter the frame.</EmptyState>}</div></ConsoleSection>

    <ConsoleSection id="selected-object" title="SELECTED OBJECT · USER" meta={live ? "Tracked" : "Waiting"}><nav className="awareness-tabs"><a href="#overview">Overview</a><a href="#overview">L1</a><a href="#overview">L2</a><a href="#overview">L3</a><a href="#overview">L4</a><a href="#relations">Relations</a><a href="#timeline">History</a></nav><div className="awareness-layer-grid" id="overview"><LayerCard code="L1" title="Motion" horizon="now → +100 ms"><Value name="Tracking">{percent(tracking.confidence)}</Value><Value name="FPS">{tracking.fps || "--"}</Value><Value name="Angles">{Object.keys(motion.angles_deg || {}).length}</Value><Value name="Prediction confidence">{percent(motion.prediction_confidence)}</Value></LayerCard><LayerCard code="L2" title="Action" horizon="action → +1 sec"><Value name="Action">{label(action.step_state)}</Value><Value name="Phase">{label(action.temporal_segmentation?.motion_phase)}</Value><Value name="Confidence">{percent(action.step_probability)}</Value><Value name="Next">{label(action.next_step_prediction)}</Value></LayerCard><LayerCard code="L3" title="Session" horizon="repetitions → minutes"><Value name="Reps">{repetitions.repetitions_completed || 0}</Value><Value name="Correct">{repetitions.correct_repetitions || 0}</Value><Value name="Consistency">{percent(session.consistency_score)}</Value><Value name="Pattern">{label(session.repeated_mistake?.issue, "Collecting")}</Value></LayerCard><LayerCard code="L4" title="Evolution" horizon="sessions → long term"><Value name="Skill">{percent(activeTechnique.mastery_score)}</Value><Value name="Best">{percent(activeTechnique.best_mastery_score)}</Value><Value name="Trend">{label(activeTechnique.learning_trend)}</Value><Value name="Persistent issue">{label(user.top_weakness?.issue, "None yet")}</Value></LayerCard></div><details className="awareness-raw-data"><summary>Expand complete L1–L4 data</summary><DataLayersPanel {...diagnostics} /></details></ConsoleSection>

    <ConsoleSection id="relations" title="RELATIONSHIP GRAPH · L1–L4" meta={`${backendRelationships.length} evidence-backed`} defaultOpen={false}>{backendRelationships.length ? <div className="awareness-layer-grid">{backendRelationships.map((relation) => <article className="awareness-layer-card" key={relation.relationship_id}><header><span>R</span><div><strong>{label(relation.relationship_type)}</strong><small>{relation.source_id} ↔ {relation.target_id}</small></div></header><Value name="L1 distance">{relation.state?.l1?.distance == null ? "--" : decimal(relation.state.l1.distance)}</Value><Value name="L2 interaction">{label(relation.state?.l2?.action)}</Value><Value name="L3 pattern">{label(relation.state?.l3?.behaviour)}</Value><Value name="L4 evolution">{label(relation.state?.l4?.evolution)}</Value></article>)}</div> : <EmptyState>Relationships appear only when verified entities have spatial evidence. YOLO remains disabled.</EmptyState>}</ConsoleSection>
    <ConsoleSection id="prediction" title="PREDICTION TIMELINE" meta={action.forecast_awareness?.trusted ? "Trusted forecast" : "Confidence gated"}><div className="awareness-prediction-line"><article><i /><span>NOW</span><strong>{label(situation.situation_state, "Observing")}</strong></article><article><i /><span>+100 ms</span><strong>{motion.prediction_confidence ? `Motion forecast · ${percent(motion.prediction_confidence)}` : "Collecting motion"}</strong></article><article><i /><span>+1 sec</span><strong>{action.forecast_awareness?.trusted ? label(action.forecast_awareness?.likely_mistake?.issue, "Forecast trusted") : "Forecast gated"}</strong></article><article><i /><span>SESSION</span><strong>{label(session.recommendation, "Collecting pattern")}</strong></article></div></ConsoleSection>
    <ConsoleSection id="reasoning" title="REASONING" meta={feedback.type ? label(feedback.type) : "Waiting"}><div className="awareness-reasoning-flow"><span>Awareness A(t)</span><b>+</b><span>Knowledge K</span><b>+</b><span>Goal G</span><b>+</b><span>Predicted future</span><strong>→</strong><span>Decision</span></div><div className="awareness-reasoning-result"><Value name="Prediction">{action.forecast_awareness?.trusted ? label(action.forecast_awareness?.likely_mistake?.issue, "Trusted motion forecast") : "No trusted future risk"}</Value><Value name="Decision">{label(situation.next_action?.command, "Observe")}</Value><Value name="Feedback">{feedback.message || "Waiting for supported evidence."}</Value><Value name="Priority">{percent(situation.agent_context?.priority)}</Value></div><details className="awareness-raw-data"><summary>Coach context packet</summary><pre>{coachPacket ? JSON.stringify(coachPacket, null, 2) : "Waiting for all temporal layers."}</pre></details></ConsoleSection>
    <ConsoleSection id="timeline" title="EVENT TIMELINE" meta={`${events.length} recent events`}><div className="awareness-event-list">{events.length ? events.map((event) => <div key={event.id}><time>{event.time}</time><i /><span>{event.text}</span></div>) : <EmptyState>Events appear as live perception, action and awareness states change.</EmptyState>}</div></ConsoleSection>
  </main>;
}
