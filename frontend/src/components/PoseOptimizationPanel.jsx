import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import PoseRangeDesigner from "./PoseRangeDesigner";
import PoseStudioContext from "./PoseStudioContext";

const OBJECTIVES = [
  ["energy_efficiency_proxy", "Energy efficiency"], ["static_stability", "Stability"],
  ["defense", "Defense"], ["readiness", "Readiness"],
  ["power_potential_proxy", "Power potential"], ["mobility", "Mobility"],
  ["structural_efficiency", "Structural efficiency"], ["joint_safety", "Joint safety"]
];
const LINKS = [["head", "shoulder_left"], ["head", "shoulder_right"], ["shoulder_left", "shoulder_right"], ["shoulder_left", "elbow_left"], ["elbow_left", "wrist_left"], ["shoulder_right", "elbow_right"], ["elbow_right", "wrist_right"], ["shoulder_left", "hip_left"], ["shoulder_right", "hip_right"], ["hip_left", "hip_right"], ["hip_left", "knee_left"], ["knee_left", "ankle_left"], ["ankle_left", "foot_left"], ["hip_right", "knee_right"], ["knee_right", "ankle_right"], ["ankle_right", "foot_right"]];
const ANGLE_VARIABLES = {
  left_elbow_flexion: "elbow_left", right_elbow_flexion: "elbow_right",
  left_shoulder_angle: "shoulder_left", right_shoulder_angle: "shoulder_right",
  left_hip_angle: "hip_left", right_hip_angle: "hip_right",
  left_knee_flexion: "knee_left", right_knee_flexion: "knee_right",
  left_ankle_angle: "ankle_left", right_ankle_angle: "ankle_right"
};

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : value; }

function posePayloadIssue(pose) {
  if (pose?.coordinate_space !== "body_normalized_v1" || !pose.landmarks) return "The pose coordinate data is incomplete.";
  for (const [name, position] of Object.entries(pose.landmarks)) {
    if (!Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 5)) {
      return `${name.replaceAll("_", " ")} is outside the usable body space.`;
    }
  }
  for (const [first, second] of LINKS) {
    const a = pose.landmarks[first]; const b = pose.landmarks[second];
    if (!a || !b) return `The pose is missing ${!a ? first : second}.`;
    if (Math.hypot(...a.map((value, index) => Number(value) - Number(b[index]))) < .001) return `${first.replaceAll("_", " ")} and ${second.replaceAll("_", " ")} overlap.`;
  }
  return "";
}

function SkeletonOverlay({ current, optimal }) {
  const project = (position) => [150 + Number(position?.[0] || 0) * 72, 145 - Number(position?.[1] || 0) * 72];
  const draw = (pose, className) => pose?.landmarks ? <g className={className}>
    {LINKS.map(([first, second]) => { const a = project(pose.landmarks[first]); const b = project(pose.landmarks[second]); return <line key={`${first}-${second}`} x1={a[0]} x2={b[0]} y1={a[1]} y2={b[1]} />; })}
    {Object.entries(pose.landmarks).map(([name, position]) => { const point = project(position); return <circle cx={point[0]} cy={point[1]} key={name} r={name === "head" ? 6 : 3} />; })}
  </g> : null;
  return <div className="pose-optimization__overlay"><svg aria-label="Current and optimal skeleton overlay" role="img" viewBox="0 0 300 300">{draw(current, "is-current")}{draw(optimal, "is-optimal")}</svg><div><span className="is-current">Current</span><span className="is-optimal">Optimal</span></div></div>;
}

async function postJson(path, body) {
  const response = await authFetch(`${API_BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => `${item.loc?.slice(1).join(".") || "request"}: ${item.msg}`).join("; ")
      : data.detail;
    throw new Error(detail || "Pose optimization request failed");
  }
  return data;
}

export default function PoseOptimizationPanel({ step, onConfigurationChange, onAcceptOptimal }) {
  const studioRef = useRef(null);
  const evaluationTimerRef = useRef(null);
  const endpointSyncTimerRef = useRef(null);
  const livePoseRef = useRef(null);
  const evaluationSequenceRef = useRef(0);
  const saved = step.pose_optimization || {};
  const [poseA, setPoseA] = useState(() => clone(saved.initial_pose || saved.pose_a || step.reference_pose));
  const [margin, setMargin] = useState(() => ({ angle_degrees: Math.min(30, Math.max(0, saved.margin?.angle_degrees ?? 3)), position_normalized: Math.max(0, saved.margin?.position_normalized ?? 0.03) }));
  const [weights, setWeights] = useState(() => Object.fromEntries(OBJECTIVES.map(([id]) => [id, saved.objective_weights?.[id] ?? 1])));
  const [search, setSearch] = useState(() => clone(saved.search));
  const [optimization, setOptimization] = useState(() => clone(saved.optimization));
  const [liveEvaluation, setLiveEvaluation] = useState(null);
  const [poseReady, setPoseReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [density, setDensity] = useState("expanded");
  const [editorOpen, setEditorOpen] = useState(true);
  const [optimizationOpen, setOptimizationOpen] = useState(true);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const handleLivePose = useCallback((pose) => {
    const sequence = ++evaluationSequenceRef.current;
    setPoseReady(false);
    window.clearTimeout(endpointSyncTimerRef.current);
    window.clearTimeout(evaluationTimerRef.current);
    const payloadIssue = posePayloadIssue(pose);
    if (payloadIssue) {
      setLiveEvaluation(null);
      setMessage(`Initial pose is not usable: ${payloadIssue}`);
      return;
    }
    evaluationTimerRef.current = window.setTimeout(async () => {
      try {
        const evaluation = await postJson("/admin/catalog/pose-optimization/evaluate", { pose });
        if (sequence !== evaluationSequenceRef.current) return;
        setLiveEvaluation(evaluation);
        if (evaluation.valid) {
          livePoseRef.current = pose;
          setPoseA(pose);
          setPoseReady(true);
          setMessage("");
        } else {
          const violation = evaluation.constraint_violations?.[0];
          setMessage(violation?.message || "Adjust the initial pose until it satisfies the safety constraints.");
        }
      } catch (error) {
        if (sequence !== evaluationSequenceRef.current) return;
        setLiveEvaluation(null);
        setMessage(`Initial pose is not usable: ${error.message}`);
      }
    }, 350);
  }, []);
  const studioContext = useMemo(() => ({
    activeEndpoint: "pose_a",
    singlePoseMode: true,
    optimalPose: optimization?.representative_pose || null,
    poseA: poseA || step.reference_pose || null
  }), [optimization?.representative_pose, poseA, step.reference_pose]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === studioRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => () => window.clearTimeout(evaluationTimerRef.current), []);

  useEffect(() => () => window.clearTimeout(endpointSyncTimerRef.current), []);

  const captureEndpoint = (_, pose, toleranceSettings) => {
    if (!poseReady) {
      setMessage("Wait for the current pose to pass safety validation before applying it.");
      return;
    }
    livePoseRef.current = pose;
    setPoseA(pose);
    const nextMargin = toleranceSettings ? {
      angle_degrees: Math.min(30, Math.max(0, Number(toleranceSettings.angle_degrees) || 0)),
      position_normalized: Math.max(0, Number(toleranceSettings.position_normalized) || 0)
    } : margin;
    if (toleranceSettings) setMargin(nextMargin);
    setSearch(null);
    setOptimization(null);
    onConfigurationChange({
      schema_version: "1.0", workflow: "initial_tolerance_v1", status: "DRAFT",
      initial_pose: pose, pose_a: pose, pose_b: pose,
      margin: nextMargin, objective_weights: weights, seed: saved.seed ?? 42
    });
    setMessage("Initial pose and tolerances captured. Generate the search ranges when ready.");
  };
  const generateRanges = async () => {
    const initialPose = livePoseRef.current;
    if (!poseReady || !initialPose) { setMessage("The current initial pose must pass safety validation before ranges can be generated."); return; }
    setBusy("ranges"); setMessage("");
    try { setPoseA(initialPose); setSearch(await postJson("/admin/catalog/pose-optimization/ranges", { pose_a: initialPose, pose_b: initialPose, margin })); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  };
  const runOptimization = async () => {
    const initialPose = livePoseRef.current;
    if (!poseReady || !initialPose) { setMessage("The current initial pose must pass safety validation before optimization can run."); return; }
    setBusy("optimization"); setMessage("");
    try {
      const result = await postJson("/admin/catalog/pose-optimization/run", { pose_a: initialPose, pose_b: initialPose, margin, objective_weights: weights, seed: saved.seed ?? 42, population_size: 48, generations: 60 });
      setSearch(result.search); setOptimization(result.optimization);
      setPoseA(initialPose);
      onConfigurationChange({ schema_version: "1.0", workflow: "initial_tolerance_v1", status: "COMPLETED", initial_pose: initialPose, pose_a: initialPose, pose_b: initialPose, margin, objective_weights: weights, seed: saved.seed ?? 42, search: result.search, optimization: result.optimization });
      const reconstruction = result.optimization?.representative_reconstruction;
      setMessage(reconstruction?.projected
        ? `Optimization complete. The Pareto vector was projected to the nearest safe skeleton (projection error ${Number(reconstruction.projection_rmse).toFixed(3)}).`
        : "Optimization complete. Review and accept the representative pose when ready.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  };
  const ranges = search?.ranges || {};
  const targets = optimization?.representative_scores || (liveEvaluation ? Object.fromEntries(Object.entries(liveEvaluation.targets).map(([id, target]) => [id, target.score])) : {});
  const currentPose = poseA || step.reference_pose;
  const optimalPose = optimization?.representative_pose;
  const sensitivityRows = useMemo(() => Object.entries(optimization?.sensitivity_and_robustness?.variables || {}).sort(([, first], [, second]) => second.sensitivity_score - first.sensitivity_score), [optimization]);

  const accept = () => {
    if (!optimalPose) return;
    const actual = optimization.representative_reconstruction?.actual_variables || optimization.representative_variables;
    const angleTargets = Object.entries(ANGLE_VARIABLES).map(([variable, bodyPart]) => ({
      body_part: bodyPart,
      label: ranges[variable]?.label || variable,
      target_angle: actual[variable],
      min: optimization.optimal_ranges[variable]?.optimal_min ?? actual[variable],
      max: optimization.optimal_ranges[variable]?.optimal_max ?? actual[variable],
      role: "supporting", weight: 1
    }));
    onAcceptOptimal({ referencePose: optimalPose, angleTargets, configuration: { schema_version: "1.0", workflow: "initial_tolerance_v1", status: "COMPLETED", initial_pose: poseA, pose_a: poseA, pose_b: poseA, margin, objective_weights: weights, seed: saved.seed ?? 42, search, optimization } });
    setMessage("Representative optimal pose applied to this step draft. Save the catalog item to publish it.");
  };
  const toggleStudioFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await studioRef.current?.requestFullscreen();
  };

  return <section className={`pose-optimization pose-optimization--${density} ${isFullscreen ? "is-fullscreen" : ""}`} ref={studioRef}>
    {!editorOpen ? <div className="pose-optimization__commandbar"><strong>Pose optimization</strong><div className="pose-optimization__endpoint-tabs"><span className="is-active">Initial {poseA ? "✓" : ""}</span><span>Optimized {optimalPose ? "✓" : "pending"}</span></div><div className="pose-optimization__studio-actions"><button className="btn btn--ghost btn--small" onClick={() => setEditorOpen(true)} type="button">Show canvas</button><button className="btn btn--light btn--small" onClick={toggleStudioFullscreen} type="button">{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button></div></div> : null}
    {message ? <p className="pose-optimization__message" role="status">{message}</p> : null}
    {editorOpen ? <div className="pose-optimization__editor"><PoseStudioContext.Provider value={studioContext}><PoseRangeDesigner key={step.step_number} initialAngleTolerance={margin.angle_degrees} onApply={captureEndpoint} onPoseChange={handleLivePose} rangeTargets={step.angle_targets || []} referencePose={poseA || step.reference_pose || null} studioLead={<div className="pose-optimization__endpoint-tabs"><span className="is-active">Initial {poseA ? "✓" : ""}</span><span>Optimized {optimalPose ? "✓" : "pending"}</span></div>} studioActions={<><button aria-pressed={density === "compact"} className={`btn btn--ghost btn--small ${density === "compact" ? "is-active" : ""}`} onClick={() => setDensity((current) => current === "compact" ? "expanded" : "compact")} title="Toggle compact workspace" type="button">Fit</button><button className="btn btn--ghost btn--small is-active" onClick={() => setEditorOpen(false)} title="Hide canvas" type="button">Canvas</button><button aria-pressed={optimizationOpen} className={`btn btn--ghost btn--small ${optimizationOpen ? "is-active" : ""}`} onClick={() => setOptimizationOpen((current) => !current)} type="button">Optimizer</button><button aria-pressed={analysisOpen} className={`btn btn--ghost btn--small ${analysisOpen ? "is-active" : ""}`} onClick={() => setAnalysisOpen((current) => !current)} type="button">Analysis</button><button className="btn btn--light btn--small" onClick={toggleStudioFullscreen} type="button">{isFullscreen ? "Exit" : "Fullscreen"}</button></>} /></PoseStudioContext.Provider></div> : null}
    {optimizationOpen ? <div className="pose-optimization__controls"><strong>Optimization</strong><span className={`pose-optimization__validation ${poseReady ? "is-valid" : "is-pending"}`}>{poseReady ? "Pose valid" : "Validating pose…"}</span><span className="pose-optimization__range-summary">Range: ±{margin.angle_degrees}° angles · ±{margin.position_normalized} position</span><button className="btn btn--ghost" disabled={Boolean(busy) || !poseReady} onClick={generateRanges} type="button">{busy === "ranges" ? "Generating…" : "1. Generate ranges"}</button><button className="btn btn--light" disabled={Boolean(busy) || !poseReady} onClick={runOptimization} type="button">{busy === "optimization" ? "Optimizing…" : "2. Run optimization"}</button></div> : null}
    {analysisOpen ? <div className="pose-optimization__analysis"><div className="pose-optimization__section-heading"><div><strong>Analysis and decision controls</strong><span>Objective priorities, live scores, ranges, robustness, and comparison.</span></div><button className="catalog-admin__text-button" onClick={() => setAnalysisOpen(false)} type="button">Compress analysis</button></div><div className="pose-optimization__weights">{OBJECTIVES.map(([id, label]) => <label key={id}>{label}<input min="0" max="10" onChange={(event) => setWeights((current) => ({ ...current, [id]: Number(event.target.value) }))} step="0.1" type="number" value={weights[id]} /></label>)}</div>
    {Object.keys(targets).length ? <div className="pose-optimization__scores">{OBJECTIVES.map(([id, label]) => <article key={id}><span>{label}</span><strong>{Number(targets[id] || 0).toFixed(1)}</strong><meter max="100" min="0" value={targets[id] || 0} /></article>)}</div> : null}
    {Object.keys(ranges).length ? <div className="pose-optimization__table-wrap"><table><caption>Generated and optimal search ranges</caption><thead><tr><th>Variable</th><th>Initial</th><th>Search range</th><th>Optimal range</th><th>Recommended</th><th>Sensitivity</th><th>Robustness</th></tr></thead><tbody>{Object.entries(ranges).map(([id, range]) => { const optimal = optimization?.optimal_ranges?.[id]; return <tr key={id}><th>{range.label}</th><td>{range.pose_a_value.toFixed(2)}</td><td>{range.search_min.toFixed(2)}–{range.search_max.toFixed(2)}</td><td>{optimal ? `${optimal.optimal_min.toFixed(2)}–${optimal.optimal_max.toFixed(2)}` : "—"}</td><td>{optimal?.representative_value?.toFixed(2) || "—"}</td><td>{optimal?.sensitivity || "—"}</td><td>{optimal?.robustness || "—"}</td></tr>; })}</tbody></table></div> : null}
    {optimalPose ? <div className="pose-optimization__results"><div><h4>Current vs optimal overlay</h4><SkeletonOverlay current={currentPose} optimal={optimalPose} /><button className="btn btn--light" onClick={accept} type="button">Accept optimal pose for this step</button></div><div><h4>Most influential variables</h4><ol>{sensitivityRows.slice(0, 8).map(([id, value]) => <li key={id}><span>{value.label}</span><strong>{value.sensitivity}</strong><small>Robustness: {value.robustness}</small></li>)}</ol></div></div> : null}</div> : null}
  </section>;
}
