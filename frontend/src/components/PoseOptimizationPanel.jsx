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
  const liveEndpointRef = useRef({ pose_a: null, pose_b: null });
  const saved = step.pose_optimization || {};
  const [activeEndpoint, setActiveEndpoint] = useState("pose_a");
  const [poseA, setPoseA] = useState(() => clone(saved.pose_a));
  const [poseB, setPoseB] = useState(() => clone(saved.pose_b));
  const [margin, setMargin] = useState(() => ({ angle_degrees: saved.margin?.angle_degrees ?? 3, position_normalized: saved.margin?.position_normalized ?? 0.03 }));
  const [weights, setWeights] = useState(() => Object.fromEntries(OBJECTIVES.map(([id]) => [id, saved.objective_weights?.[id] ?? 1])));
  const [search, setSearch] = useState(() => clone(saved.search));
  const [optimization, setOptimization] = useState(() => clone(saved.optimization));
  const [liveEvaluation, setLiveEvaluation] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [density, setDensity] = useState("expanded");
  const [editorOpen, setEditorOpen] = useState(true);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const endpointPose = activeEndpoint === "pose_a" ? poseA : poseB;
  const handleLivePose = useCallback((pose) => {
    liveEndpointRef.current[activeEndpoint] = pose;
    window.clearTimeout(endpointSyncTimerRef.current);
    endpointSyncTimerRef.current = window.setTimeout(() => {
      if (activeEndpoint === "pose_a") setPoseA(pose);
      else setPoseB(pose);
    }, 180);
    window.clearTimeout(evaluationTimerRef.current);
    evaluationTimerRef.current = window.setTimeout(async () => {
      try { setLiveEvaluation(await postJson("/admin/catalog/pose-optimization/evaluate", { pose })); }
      catch (error) { setMessage(error.message); }
    }, 350);
  }, [activeEndpoint]);
  const studioContext = useMemo(() => ({
    activeEndpoint,
    optimalPose: optimization?.representative_pose || null,
    poseA: poseA || step.reference_pose || null,
    poseB: poseB || step.reference_pose || null
  }), [activeEndpoint, optimization?.representative_pose, poseA, poseB, step.reference_pose]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === studioRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => () => window.clearTimeout(evaluationTimerRef.current), []);

  useEffect(() => () => window.clearTimeout(endpointSyncTimerRef.current), []);

  const selectEndpoint = (nextEndpoint) => {
    const livePose = liveEndpointRef.current[activeEndpoint];
    if (livePose) {
      if (activeEndpoint === "pose_a") setPoseA(livePose);
      else setPoseB(livePose);
    }
    setActiveEndpoint(nextEndpoint);
  };

  const captureEndpoint = (_, pose) => {
    liveEndpointRef.current[activeEndpoint] = pose;
    const nextPoseA = activeEndpoint === "pose_a" ? pose : poseA;
    const nextPoseB = activeEndpoint === "pose_b" ? pose : poseB;
    if (activeEndpoint === "pose_a") setPoseA(pose); else setPoseB(pose);
    setSearch(null);
    setOptimization(null);
    onConfigurationChange({
      schema_version: "1.0", status: "DRAFT", pose_a: nextPoseA, pose_b: nextPoseB,
      margin, objective_weights: weights, seed: saved.seed ?? 42
    });
    setMessage(`${activeEndpoint === "pose_a" ? "Pose A" : "Pose B"} captured.`);
  };
  const generateRanges = async () => {
    if (!poseA || !poseB) { setMessage("Capture both Pose A and Pose B first."); return; }
    setBusy("ranges"); setMessage("");
    try { setSearch(await postJson("/admin/catalog/pose-optimization/ranges", { pose_a: poseA, pose_b: poseB, margin })); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  };
  const runOptimization = async () => {
    if (!poseA || !poseB) { setMessage("Capture both Pose A and Pose B first."); return; }
    setBusy("optimization"); setMessage("");
    try {
      const result = await postJson("/admin/catalog/pose-optimization/run", { pose_a: poseA, pose_b: poseB, margin, objective_weights: weights, seed: saved.seed ?? 42, population_size: 48, generations: 60 });
      setSearch(result.search); setOptimization(result.optimization);
      onConfigurationChange({ schema_version: "1.0", status: "COMPLETED", pose_a: poseA, pose_b: poseB, margin, objective_weights: weights, seed: saved.seed ?? 42, search: result.search, optimization: result.optimization });
      const reconstruction = result.optimization?.representative_reconstruction;
      setMessage(reconstruction?.projected
        ? `Optimization complete. The Pareto vector was projected to the nearest safe skeleton (projection error ${Number(reconstruction.projection_rmse).toFixed(3)}).`
        : "Optimization complete. Review and accept the representative pose when ready.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  };
  const ranges = search?.ranges || {};
  const targets = optimization?.representative_scores || (liveEvaluation ? Object.fromEntries(Object.entries(liveEvaluation.targets).map(([id, target]) => [id, target.score])) : {});
  const currentPose = step.reference_pose || poseA;
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
    onAcceptOptimal({ referencePose: optimalPose, angleTargets, configuration: { schema_version: "1.0", status: "COMPLETED", pose_a: poseA, pose_b: poseB, margin, objective_weights: weights, seed: saved.seed ?? 42, search, optimization } });
    setMessage("Representative optimal pose applied to this step draft. Save the catalog item to publish it.");
  };
  const toggleStudioFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await studioRef.current?.requestFullscreen();
  };

  return <section className={`pose-optimization pose-optimization--${density} ${isFullscreen ? "is-fullscreen" : ""}`} ref={studioRef}>
    <div className="pose-optimization__heading"><div><span className="catalog-admin__eyebrow">Scientific pose optimization studio</span><h3>Pose A → Optimal pose → Pose B</h3><p>Compare all three skeletons in one studio, edit each endpoint, analyze the Pareto region, and apply the representative pose.</p></div><div className="pose-optimization__studio-actions"><button className="btn btn--ghost btn--small" onClick={() => setDensity((current) => current === "compact" ? "expanded" : "compact")} type="button">{density === "compact" ? "Expand layout" : "Compact layout"}</button><button className="btn btn--ghost btn--small" onClick={() => setEditorOpen((current) => !current)} type="button">{editorOpen ? "Hide editor" : "Show editor"}</button><button className="btn btn--ghost btn--small" onClick={() => setAnalysisOpen((current) => !current)} type="button">{analysisOpen ? "Hide analysis" : "Show analysis"}</button><button className="btn btn--light btn--small" onClick={toggleStudioFullscreen} type="button">{isFullscreen ? "Exit fullscreen" : "Fullscreen studio"}</button></div></div>
    {message ? <p className="pose-optimization__message" role="status">{message}</p> : null}
    <div className="pose-optimization__endpoint-tabs"><button className={activeEndpoint === "pose_a" ? "is-active" : ""} onClick={() => selectEndpoint("pose_a")} type="button">Edit Pose A {poseA ? "✓" : ""}</button><button className={activeEndpoint === "pose_b" ? "is-active" : ""} onClick={() => selectEndpoint("pose_b")} type="button">Edit Pose B {poseB ? "✓" : ""}</button></div>
    {editorOpen ? <div className="pose-optimization__editor"><div className="pose-optimization__section-heading"><div><strong>{activeEndpoint === "pose_a" ? "Pose A editor" : "Pose B editor"}</strong><span>All three skeletons share the 3D viewport. The white skeleton is editable; the center optimum is read-only.</span></div><button className="catalog-admin__text-button" onClick={() => setEditorOpen(false)} type="button">Compress editor</button></div><PoseStudioContext.Provider value={studioContext}><PoseRangeDesigner key={`${step.step_number}-${activeEndpoint}`} onApply={captureEndpoint} onPoseChange={handleLivePose} rangeTargets={step.angle_targets || []} referencePose={endpointPose || step.reference_pose || null} /></PoseStudioContext.Provider></div> : null}
    <div className="pose-optimization__controls"><label>Angle margin<input min="0" max="30" onChange={(event) => setMargin((current) => ({ ...current, angle_degrees: Number(event.target.value) }))} type="number" value={margin.angle_degrees} /><span>°</span></label><label>Position margin<input min="0" max="0.25" onChange={(event) => setMargin((current) => ({ ...current, position_normalized: Number(event.target.value) }))} step="0.01" type="number" value={margin.position_normalized} /></label><button className="btn btn--ghost" disabled={Boolean(busy)} onClick={generateRanges} type="button">{busy === "ranges" ? "Generating…" : "Generate ranges"}</button><button className="btn btn--light" disabled={Boolean(busy) || !poseA || !poseB} onClick={runOptimization} type="button">{busy === "optimization" ? "Optimizing…" : "Run optimization"}</button></div>
    {analysisOpen ? <div className="pose-optimization__analysis"><div className="pose-optimization__section-heading"><div><strong>Analysis and decision controls</strong><span>Objective priorities, live scores, ranges, robustness, and comparison.</span></div><button className="catalog-admin__text-button" onClick={() => setAnalysisOpen(false)} type="button">Compress analysis</button></div><div className="pose-optimization__weights">{OBJECTIVES.map(([id, label]) => <label key={id}>{label}<input min="0" max="10" onChange={(event) => setWeights((current) => ({ ...current, [id]: Number(event.target.value) }))} step="0.1" type="number" value={weights[id]} /></label>)}</div>
    {Object.keys(targets).length ? <div className="pose-optimization__scores">{OBJECTIVES.map(([id, label]) => <article key={id}><span>{label}</span><strong>{Number(targets[id] || 0).toFixed(1)}</strong><meter max="100" min="0" value={targets[id] || 0} /></article>)}</div> : null}
    {Object.keys(ranges).length ? <div className="pose-optimization__table-wrap"><table><caption>Generated and optimal search ranges</caption><thead><tr><th>Variable</th><th>Pose A</th><th>Pose B</th><th>Search</th><th>Optimal</th><th>Recommended</th><th>Sensitivity</th><th>Robustness</th></tr></thead><tbody>{Object.entries(ranges).map(([id, range]) => { const optimal = optimization?.optimal_ranges?.[id]; return <tr key={id}><th>{range.label}</th><td>{range.pose_a_value.toFixed(2)}</td><td>{range.pose_b_value.toFixed(2)}</td><td>{range.search_min.toFixed(2)}–{range.search_max.toFixed(2)}</td><td>{optimal ? `${optimal.optimal_min.toFixed(2)}–${optimal.optimal_max.toFixed(2)}` : "—"}</td><td>{optimal?.representative_value?.toFixed(2) || "—"}</td><td>{optimal?.sensitivity || "—"}</td><td>{optimal?.robustness || "—"}</td></tr>; })}</tbody></table></div> : null}
    {optimalPose ? <div className="pose-optimization__results"><div><h4>Current vs optimal overlay</h4><SkeletonOverlay current={currentPose} optimal={optimalPose} /><button className="btn btn--light" onClick={accept} type="button">Accept optimal pose for this step</button></div><div><h4>Most influential variables</h4><ol>{sensitivityRows.slice(0, 8).map(([id, value]) => <li key={id}><span>{value.label}</span><strong>{value.sensitivity}</strong><small>Robustness: {value.robustness}</small></li>)}</ol></div></div> : null}</div> : null}
  </section>;
}
