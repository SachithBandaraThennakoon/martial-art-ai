import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import PoseOptimizationPanel from "../components/PoseOptimizationPanel";
import ManualPosePanel from "../components/ManualPosePanel";

const PLAN_OPTIONS = ["FREE_PLAN", "STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function newTarget() {
  return { body_part: "elbow_left", label: "Elbow alignment", target_angle: 90, min: 70, max: 110, role: "primary", weight: 1 };
}

function newStep(number) {
  return { step_number: number, step_name: `Step ${number}`, angle_targets: [newTarget()], reference_pose: null };
}

function newBiomechanics() {
  return { schema_version: "1.0", review_status: "DRAFT", reviewed_by: "", measurements: [] };
}

function newPackage() {
  return {
    id: "",
    enabled: true,
    has_tracking: false,
    catalog: {
      schema_version: "1.0", id: "", name: "", tracking_package: "", tracking_version: "1.0.0",
      category: "Technique Training", subcategory: "Punching", difficulty: "Beginner",
      price: 0, required_plan: "FREE_PLAN", description: ""
    },
    training_steps: { schema_version: "2.0", technique_id: "", steps: [newStep(1)], biomechanics: newBiomechanics() }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export default function TechniqueCatalogAdmin({ manualMode = false }) {
  const [packages, setPackages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [poseStepIndex, setPoseStepIndex] = useState(0);
  const [workspacePanel, setWorkspacePanel] = useState("pose");

  const loadPackages = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/catalog`);
      if (!response.ok) throw new Error("Unable to load the technique catalog");
      const data = await response.json();
      setPackages(data.techniques || []);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  const categories = useMemo(() => [...new Set(packages.map((item) => item.catalog.category).filter(Boolean))], [packages]);

  const updateCatalog = (field, value) => setDraft((current) => ({ ...current, catalog: { ...current.catalog, [field]: value } }));
  const updateStep = (stepIndex, field, value) => setDraft((current) => {
    const steps = [...current.training_steps.steps];
    steps[stepIndex] = { ...steps[stepIndex], [field]: value };
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });
  const updateTarget = (stepIndex, targetIndex, field, value) => setDraft((current) => {
    const steps = [...current.training_steps.steps];
    const targets = [...(steps[stepIndex].angle_targets || [])];
    targets[targetIndex] = { ...targets[targetIndex], [field]: value };
    steps[stepIndex] = { ...steps[stepIndex], angle_targets: targets };
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });

  const selectPackage = (item) => {
    setStatus({ type: "", message: "" });
    const editable = clone(item);
    editable.training_steps.biomechanics = { ...newBiomechanics(), ...editable.training_steps.biomechanics };
    setDraft(editable);
    setPoseStepIndex(0);
    setWorkspacePanel("pose");
  };

  const addStep = () => setDraft((current) => {
    const steps = current.training_steps.steps;
    if (steps.length >= 3) return current;
    return { ...current, training_steps: { ...current.training_steps, steps: [...steps, newStep(steps.length + 1)] } };
  });

  const removeStep = (stepIndex) => {
    setDraft((current) => {
      if (current.training_steps.steps.length === 1) return current;
      const steps = current.training_steps.steps.filter((_, index) => index !== stepIndex)
        .map((step, index) => ({ ...step, step_number: index + 1 }));
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
    setPoseStepIndex((current) => Math.max(0, current > stepIndex ? current - 1 : Math.min(current, draft.training_steps.steps.length - 2)));
  };

  const clearStepReferencePose = (stepIndex) => setDraft((current) => {
    const steps = [...current.training_steps.steps];
    steps[stepIndex] = { ...steps[stepIndex], reference_pose: null };
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });

  const updatePoseOptimization = (configuration) => {
    setDraft((current) => {
      const steps = [...current.training_steps.steps];
      steps[poseStepIndex] = { ...steps[poseStepIndex], pose_optimization: configuration };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
  };

  const acceptOptimalPose = ({ referencePose, angleTargets, configuration }) => {
    setDraft((current) => {
      const steps = [...current.training_steps.steps];
      steps[poseStepIndex] = { ...steps[poseStepIndex], reference_pose: referencePose, angle_targets: angleTargets, pose_optimization: configuration };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
    setStatus({ type: "success", message: "Optimal pose applied to this step draft. Save the catalog item to publish it." });
  };

  const applyManualPose = ({ referencePose, angleTargets }) => {
    setDraft((current) => {
      const steps = [...current.training_steps.steps];
      const stepWithoutOptimization = { ...steps[poseStepIndex] };
      delete stepWithoutOptimization.pose_optimization;
      steps[poseStepIndex] = {
        ...stepWithoutOptimization,
        reference_pose: referencePose,
        angle_targets: angleTargets,
      };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
    setStatus({ type: "success", message: "Manual pose applied to this step draft. Save the catalog item to persist it." });
  };

  const syncManualPose = useCallback((referencePose, angleTargets) => {
    setDraft((current) => {
      if (!current?.training_steps?.steps?.[poseStepIndex]) return current;
      const steps = [...current.training_steps.steps];
      const stepWithoutOptimization = { ...steps[poseStepIndex] };
      delete stepWithoutOptimization.pose_optimization;
      steps[poseStepIndex] = {
        ...stepWithoutOptimization,
        reference_pose: referencePose,
        angle_targets: angleTargets,
      };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
  }, [poseStepIndex]);

  const save = async () => {
    if (!draft) return;
    const creating = !packages.some((item) => item.id === draft.id);
    const generatedId = slugify(draft.catalog.id || draft.catalog.name);
    const payload = clone(draft);
    payload.catalog.id = generatedId;
    payload.catalog.tracking_package = payload.catalog.tracking_package || generatedId;
    payload.training_steps.technique_id = generatedId;
    setIsSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const response = await authFetch(
        `${API_BASE_URL}/admin/catalog${creating ? "" : `/${draft.id}`}`,
        { method: creating ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to save this technique");
      setStatus({ type: "success", message: `${payload.catalog.name} saved. The database catalog is synchronized.` });
      setDraft(null);
      await loadPackages();
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const archive = async () => {
    if (!draft || !packages.some((item) => item.id === draft.id)) return;
    if (!window.confirm(`Archive ${draft.catalog.name}? It will be hidden from the active catalog but its files remain recoverable.`)) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/catalog/${draft.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to archive this technique");
      setStatus({ type: "success", message: `${draft.catalog.name} was archived.` });
      setDraft(null);
      await loadPackages();
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  };

  return (
    <main className="studio-page studio-page--admin catalog-admin-page">
      <section className="studio-hub catalog-admin__hub">
      {status.message ? <p aria-live="polite" className={`catalog-admin__notice catalog-admin__notice--${status.type}`} role={status.type === "error" ? "alert" : "status"}>{status.message}</p> : null}
      <header className="catalog-admin__appbar">
        <div className="catalog-admin__app-brand"><span>MA</span><strong>{manualMode ? "Manual Catalog Studio" : "Catalog Studio"}</strong></div>
        <label className="catalog-admin__technique-select"><span>Technique</span><select disabled={isLoading} onChange={(event) => { const item = packages.find((entry) => entry.id === event.target.value); if (item) selectPackage(item); }} value={packages.some((item) => item.id === draft?.id) ? draft.id : ""}><option value="">{isLoading ? "Loading techniques…" : "Select a technique…"}</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.catalog.name}</option>)}</select></label>
        <label className="catalog-admin__technique-select catalog-admin__step-select-top"><span>Step</span><select disabled={!draft} onChange={(event) => setPoseStepIndex(Number(event.target.value))} value={poseStepIndex}>{draft?.training_steps.steps.map((step, index) => <option key={step.step_number} value={index}>{index + 1}. {step.step_name}</option>)}</select></label>
        <nav className="catalog-admin__workspace-tabs" aria-label="Catalog workspace panels">
          {[['details', 'Details'], ['pose', 'Pose Studio'], ['steps', 'Step Data']].map(([id, label]) => <button aria-pressed={workspacePanel === id} className={workspacePanel === id ? "is-active" : ""} disabled={!draft} key={id} onClick={() => setWorkspacePanel(id)} type="button">{label}</button>)}
        </nav>
        <div className="catalog-admin__app-actions"><button className="btn btn--ghost btn--small" onClick={() => selectPackage(newPackage())} type="button">New</button>{draft && packages.some((item) => item.id === draft.id) ? <button className="btn btn--danger btn--small" onClick={archive} type="button">Archive</button> : null}<button className="btn btn--light btn--small" disabled={!draft || isSaving} onClick={save} type="button">{isSaving ? "Saving…" : "Save"}</button></div>
      </header>
      <section className="catalog-admin__workspace">
        <aside className="catalog-admin__tool-rail" aria-label="Workspace tools">
          <button className={workspacePanel === "details" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("details")} title="Technique details" type="button"><b>D</b><span>Details</span></button>
          <button className={workspacePanel === "pose" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("pose")} title="Pose studio" type="button"><b>P</b><span>Pose</span></button>
          <button className={workspacePanel === "steps" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("steps")} title="Step data" type="button"><b>S</b><span>Steps</span></button>
        </aside>
        <section className="catalog-admin__editor-panel">
          {!draft ? <div className="catalog-admin__empty"><h2>Select an item</h2><p>Choose a catalog item to edit it, or create a new one.</p></div> : <>
            {workspacePanel !== "pose" ? <div className="catalog-admin__editor-heading"><div><span className="catalog-admin__eyebrow">{packages.some((item) => item.id === draft.id) ? "Editing" : "New item"}</span><h2>{draft.catalog.name || "Untitled catalog item"}</h2></div>{draft.has_tracking ? <span className="catalog-admin__tracking">Tracking package attached</span> : <span className="catalog-admin__tracking">Catalog-only package</span>}</div> : null}
            {workspacePanel === "details" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--details">
            <div className="catalog-admin__form-grid">
              <label>Name<input value={draft.catalog.name} onChange={(event) => updateCatalog("name", event.target.value)} /></label>
              <label>Package ID<input disabled={packages.some((item) => item.id === draft.id)} value={draft.catalog.id} onChange={(event) => updateCatalog("id", slugify(event.target.value))} placeholder="jab" /></label>
              <label>Category<input list="catalog-categories" value={draft.catalog.category} onChange={(event) => updateCatalog("category", event.target.value)} /></label>
              <label>Subcategory<input value={draft.catalog.subcategory} onChange={(event) => updateCatalog("subcategory", event.target.value)} placeholder="Punching" /></label>
              <label>Difficulty<select value={draft.catalog.difficulty} onChange={(event) => updateCatalog("difficulty", event.target.value)}>{DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Required plan<select value={draft.catalog.required_plan} onChange={(event) => updateCatalog("required_plan", event.target.value)}>{PLAN_OPTIONS.map((item) => <option key={item}>{item.replace("_PLAN", "")}</option>)}</select></label>
              <label>Price<input min="0" step="0.01" type="number" value={draft.catalog.price} onChange={(event) => updateCatalog("price", Number(event.target.value))} /></label>
              <label className="catalog-admin__checkbox"><input checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /> Available in catalog</label>
              <label className="catalog-admin__full">Description<textarea value={draft.catalog.description} onChange={(event) => updateCatalog("description", event.target.value)} placeholder="Explain the setup, execution, and any safety guidance." rows="3" /></label>
            </div>
            <datalist id="catalog-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
            </section> : null}
            {workspacePanel === "steps" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--steps">
            <div className="catalog-admin__steps-heading"><div><h3>Steps and angle ranges</h3><p>Keep steps in performance order. Each range feeds scoring and coaching.</p></div><button className="btn btn--ghost btn--small" disabled={draft.training_steps.steps.length >= 3} onClick={addStep} type="button">Add step</button></div>
            <div className="catalog-admin__steps">{draft.training_steps.steps.map((step, stepIndex) => <article className="catalog-admin__step" key={`${step.step_number}-${stepIndex}`}><div className="catalog-admin__step-top"><span>Step {stepIndex + 1}</span><input value={step.step_name} onChange={(event) => updateStep(stepIndex, "step_name", event.target.value)} /><button className="catalog-admin__text-button" disabled={draft.training_steps.steps.length === 1} onClick={() => removeStep(stepIndex)} type="button">Remove step</button></div><div className="catalog-admin__step-meta"><span className={`catalog-admin__step-pose-status ${step.reference_pose ? "has-pose" : "no-pose"}`}>{step.reference_pose ? "Saved reference pose" : "No saved reference pose"}</span>{step.reference_pose ? <button className="catalog-admin__text-button" onClick={() => clearStepReferencePose(stepIndex)} type="button">Clear pose</button> : null}</div><div className="catalog-admin__ranges">{(step.angle_targets || []).map((target, targetIndex) => <div className="catalog-admin__range" key={`${target.body_part}-${targetIndex}`}><input aria-label="Body part" value={target.body_part} onChange={(event) => updateTarget(stepIndex, targetIndex, "body_part", event.target.value)} /><input aria-label="Range label" value={target.label || ""} onChange={(event) => updateTarget(stepIndex, targetIndex, "label", event.target.value)} placeholder="Label" /><input aria-label="Minimum angle" min="0" max="180" type="number" value={target.min} onChange={(event) => updateTarget(stepIndex, targetIndex, "min", Number(event.target.value))} /><span>to</span><input aria-label="Maximum angle" min="0" max="180" type="number" value={target.max} onChange={(event) => updateTarget(stepIndex, targetIndex, "max", Number(event.target.value))} /><button className="catalog-admin__text-button" disabled={step.angle_targets.length === 1} onClick={() => setDraft((current) => { const steps = [...current.training_steps.steps]; steps[stepIndex] = { ...steps[stepIndex], angle_targets: step.angle_targets.filter((_, index) => index !== targetIndex) }; return { ...current, training_steps: { ...current.training_steps, steps } }; })} type="button">×</button></div>)}<button className="catalog-admin__add-range" onClick={() => updateStep(stepIndex, "angle_targets", [...(step.angle_targets || []), newTarget()])} type="button">+ Add angle range</button></div></article>)}</div>
            </section> : null}
            {workspacePanel === "pose" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--pose">
            {manualMode ? <ManualPosePanel
              key={`${draft.id || draft.catalog.id || "new"}-${draft.training_steps.steps[poseStepIndex]?.step_number}`}
              onApplyManualPose={applyManualPose}
              onManualPoseChange={syncManualPose}
              step={draft.training_steps.steps[poseStepIndex]}
            /> : <PoseOptimizationPanel
              key={draft.training_steps.steps[poseStepIndex]?.step_number}
              onAcceptOptimal={acceptOptimalPose}
              onConfigurationChange={updatePoseOptimization}
              step={draft.training_steps.steps[poseStepIndex]}
            />}
            </section> : null}
          </>}
        </section>
      </section>
      </section>
    </main>
  );
}
