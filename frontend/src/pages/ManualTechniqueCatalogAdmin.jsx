import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import ManualPosePanel from "../components/ManualPosePanel";
import GuideContentEditor from "../components/GuideContentEditor";
import { STRIKING_SURFACES } from "../data/strikingSurfaces";

const PLAN_OPTIONS = ["FREE_PLAN", "STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function newTarget() {
  return { body_part: "elbow_left", label: "Elbow alignment", target_angle: 90, min: 70, max: 110, role: "primary", weight: 1 };
}

function newStep(number) {
  return { step_number: number, step_name: `Step ${number}`, striking_surface: "", striking_side: "", transition_duration_ms: 1600, angle_targets: [newTarget()], reference_pose: null };
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

export default function ManualCatalogWorkspace() {
  const [packages, setPackages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [poseStepIndex, setPoseStepIndex] = useState(0);
  const [poseEditorRevision, setPoseEditorRevision] = useState(0);
  const [workspacePanel, setWorkspacePanel] = useState("pose");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [revisions, setRevisions] = useState([]);

  const loadPackages = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/catalog`);
      if (!response.ok) throw new Error("Unable to load the technique catalog");
      const data = await response.json();
      const techniques = data.techniques || [];
      setPackages(techniques);
      return techniques;
    } catch (error) {
      setStatus({ type: "error", message: error.message });
      return null;
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

  const loadRevisions = useCallback(async (techniqueId) => {
    if (!techniqueId) return setRevisions([]);
    const response = await authFetch(`${API_BASE_URL}/admin/techniques/${techniqueId}/revisions`);
    if (!response.ok) return setRevisions([]);
    const data = await response.json();
    setRevisions(data.revisions || []);
  }, []);

  const selectPackage = async (item) => {
    setStatus({ type: "", message: "" });
    let editable = clone(item);
    if (packages.some((entry) => entry.id === item.id)) {
      try {
        const response = await authFetch(`${API_BASE_URL}/admin/techniques/${item.id}/runtime`);
        if (response.ok) editable = { ...editable, ...(await response.json()) };
        await loadRevisions(item.id);
      } catch {
        setStatus({ type: "error", message: "Runtime data could not be loaded; showing the package fallback." });
      }
    } else {
      setRevisions([]);
    }
    editable.training_steps.biomechanics = { ...newBiomechanics(), ...editable.training_steps.biomechanics };
    setDraft(editable);
    setSavedSnapshot(JSON.stringify(editable));
    setPoseStepIndex(0);
    setPoseEditorRevision((value) => value + 1);
    setWorkspacePanel("pose");
  };

  const isExisting = Boolean(draft && packages.some((item) => item.id === draft.id));
  const isDirty = Boolean(draft && JSON.stringify(draft) !== savedSnapshot);
  const draftIssues = useMemo(() => {
    if (!draft) return [];
    const issues = [];
    if (!draft.catalog.name.trim()) issues.push("Add a technique name");
    if (!slugify(draft.catalog.id || draft.catalog.name)) issues.push("Add a valid package ID");
    if (!draft.catalog.category.trim()) issues.push("Add a category");
    draft.training_steps.steps.forEach((step, index) => {
      if (!step.step_name.trim()) issues.push(`Name step ${index + 1}`);
      if (!step.reference_pose) issues.push(`Author a reference pose for step ${index + 1}`);
      if (!(step.angle_targets || []).length) issues.push(`Add an angle range to step ${index + 1}`);
    });
    if (draft.learning_content?.status === "PUBLISHED") {
      if (!draft.learning_content.overview?.summary?.trim()) issues.push("Add a Guide summary before publishing");
      if (!draft.learning_content.principles?.length) issues.push("Add a Guide principle before publishing");
      if (draft.learning_content.principles?.some((item) => !item.title?.trim() || !item.explanation?.trim())) issues.push("Complete every Guide principle before publishing");
    }
    return issues;
  }, [draft]);

  const choosePackage = (item) => {
    if (!item || item.id === draft?.id) return;
    if (isDirty && !window.confirm("Discard your unsaved catalog changes?")) return;
    selectPackage(item);
  };

  const addStep = () => setDraft((current) => {
    const steps = current.training_steps.steps;
    if (steps.length >= 12) return current;
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

  const applyManualPose = ({ referencePose, angleTargets }) => {
    setDraft((current) => {
      const steps = [...current.training_steps.steps];
      steps[poseStepIndex] = {
        ...steps[poseStepIndex],
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
      steps[poseStepIndex] = {
        ...steps[poseStepIndex],
        reference_pose: referencePose,
        angle_targets: angleTargets,
      };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
  }, [poseStepIndex]);

  const save = async () => {
    if (!draft) return;
    if (draftIssues.length) {
      setStatus({ type: "error", message: draftIssues[0] });
      return;
    }
    const creating = !packages.some((item) => item.id === draft.id);
    const generatedId = slugify(draft.catalog.id || draft.catalog.name);
    const payload = clone(draft);
    payload.id = generatedId;
    payload.catalog.id = generatedId;
    payload.catalog.tracking_package = payload.catalog.tracking_package || generatedId;
    payload.training_steps.technique_id = generatedId;
    setIsSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const endpoint = creating
        ? `${API_BASE_URL}/admin/catalog`
        : `${API_BASE_URL}/admin/techniques/${draft.id}/publish`;
      const body = creating ? payload : {
        catalog: payload.catalog,
        training_config: payload.training_steps,
        learning_content: payload.learning_content || null,
      };
      const response = await authFetch(endpoint, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to save this technique");
      setStatus({ type: "success", message: `${payload.catalog.name} ${creating ? "created and synchronized" : `published as version ${data.version}`}.` });
      if (creating) await loadPackages();
      const currentDraft = clone(payload);
      currentDraft.training_steps.biomechanics = {
        ...newBiomechanics(),
        ...currentDraft.training_steps.biomechanics,
      };
      setDraft(currentDraft);
      setSavedSnapshot(JSON.stringify(currentDraft));
      setPoseStepIndex((current) =>
        Math.min(current, currentDraft.training_steps.steps.length - 1),
      );
      if (!creating) await loadRevisions(generatedId);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const rollback = async (revision) => {
    if (!draft || !window.confirm(`Restore version ${revision.version}? This creates a new published version.`)) return;
    setIsSaving(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/techniques/${draft.id}/revisions/${revision.id}/rollback`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to restore this revision");
      setStatus({ type: "success", message: `Version ${revision.version} restored as ${data.version}.` });
      const source = packages.find((item) => item.id === draft.id);
      if (source) await selectPackage(source);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const saveShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (draft && !isSaving) save();
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  });

  const reuseEarlierStep = (sourceStepIndex, targetStepIndex) => {
    const sourceStep = draft?.training_steps?.steps?.[sourceStepIndex];
    if (!sourceStep?.reference_pose || sourceStepIndex >= targetStepIndex) {
      setStatus({ type: "error", message: "Choose an earlier step that has a saved reference pose." });
      return;
    }
    setDraft((current) => {
      const steps = [...current.training_steps.steps];
      const source = steps[sourceStepIndex];
      const target = steps[targetStepIndex];
      steps[targetStepIndex] = {
        ...target,
        angle_targets: clone(source.angle_targets || []),
        reference_pose: clone(source.reference_pose),
      };
      return { ...current, training_steps: { ...current.training_steps, steps } };
    });
    setPoseEditorRevision((value) => value + 1);
    setStatus({
      type: "success",
      message: `${sourceStep.step_name} pose data copied into Step ${targetStepIndex + 1}. Adjust the changed joints, then save.`,
    });
  };
  const updateTransitionDuration = (stepIndex, value) => setDraft((current) => {
    const steps = [...current.training_steps.steps];
    const duration = Math.max(200, Math.min(10000, Number(value) || 1600));
    const cycle = current.training_steps.cycle;
    if (cycle?.enabled && stepIndex === steps.length - 1) {
      return {
        ...current,
        training_steps: {
          ...current.training_steps,
          cycle: { ...cycle, transition_duration_ms: duration },
        },
      };
    }
    steps[stepIndex] = {
      ...steps[stepIndex],
      transition_duration_ms: duration,
    };
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });

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

  const poseSteps = draft?.training_steps?.steps || [];
  const poseCycle = draft?.training_steps?.cycle;
  const isCycleReturn = Boolean(
    poseCycle?.enabled && poseStepIndex === poseSteps.length - 1,
  );
  const cycleTargetIndex = Math.max(
    0,
    Math.min(poseSteps.length - 1, Number(poseCycle?.return_to_step_number || 1) - 1),
  );
  const poseTransitionTarget =
    poseSteps[poseStepIndex + 1] || (isCycleReturn ? poseSteps[cycleTargetIndex] : null);
  const poseTransitionDuration = isCycleReturn
    ? poseCycle.transition_duration_ms
    : poseSteps[poseStepIndex]?.transition_duration_ms;

  return (
    <main className="studio-page studio-page--admin catalog-admin-page">
      <section className="studio-hub catalog-admin__hub">
      {status.message ? <p aria-live="polite" className={`catalog-admin__notice catalog-admin__notice--${status.type}`} role={status.type === "error" ? "alert" : "status"}>{status.message}</p> : null}
      <header className="catalog-admin__appbar">
        <div className="catalog-admin__app-brand"><span>MA</span><strong>Manual Catalog Studio</strong></div>
        <label className="catalog-admin__technique-select"><span>Technique</span><select disabled={isLoading} onChange={(event) => choosePackage(packages.find((entry) => entry.id === event.target.value))} value={isExisting ? draft.id : ""}><option value="">{isLoading ? "Loading techniques…" : `Select from ${packages.length} technique${packages.length === 1 ? "" : "s"}…`}</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.catalog.name}</option>)}</select></label>
        <label className="catalog-admin__technique-select catalog-admin__step-select-top"><span>Step</span><select disabled={!draft} onChange={(event) => setPoseStepIndex(Number(event.target.value))} value={poseStepIndex}>{draft?.training_steps.steps.map((step, index) => <option key={step.step_number} value={index}>{index + 1}. {step.step_name}</option>)}</select></label>
        <nav className="catalog-admin__workspace-tabs" aria-label="Catalog workspace panels">
          {[['details', 'Details'], ['pose', 'Pose Studio'], ['steps', 'Step Data'], ['guide', 'Guide Studio'], ['history', 'History']].map(([id, label]) => <button aria-pressed={workspacePanel === id} className={workspacePanel === id ? "is-active" : ""} disabled={!draft} key={id} onClick={() => setWorkspacePanel(id)} type="button">{label}</button>)}
        </nav>
        <div className="catalog-admin__app-actions">{draft ? <span className={`catalog-admin__save-state ${isDirty ? "is-dirty" : ""}`}>{isDirty ? "Unpublished" : "Published"}</span> : null}<button className="btn btn--ghost btn--small" onClick={() => { if (!isDirty || window.confirm("Discard your unsaved catalog changes?")) selectPackage(newPackage()); }} type="button">New</button>{isExisting ? <button className="btn btn--danger btn--small" onClick={archive} type="button">Archive</button> : null}<button className="btn btn--light btn--small" disabled={!draft || isSaving || !isDirty || draftIssues.length > 0} onClick={save} title={draftIssues[0] || "Publish runtime data (Ctrl+S)"} type="button">{isSaving ? "Publishing…" : isExisting ? "Publish" : "Create"}</button></div>
      </header>
      <section className="catalog-admin__workspace">
        <aside className="catalog-admin__tool-rail" aria-label="Workspace tools">
          <button className={workspacePanel === "details" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("details")} title="Technique details" type="button"><b>D</b><span>Details</span></button>
          <button className={workspacePanel === "pose" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("pose")} title="Pose studio" type="button"><b>P</b><span>Pose</span></button>
          <button className={workspacePanel === "steps" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("steps")} title="Step data" type="button"><b>S</b><span>Steps</span></button>
          <button className={workspacePanel === "guide" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("guide")} title="Guide studio" type="button"><b>G</b><span>Guide</span></button>
          <button className={workspacePanel === "history" ? "is-active" : ""} disabled={!draft} onClick={() => setWorkspacePanel("history")} title="Publication history" type="button"><b>H</b><span>History</span></button>
        </aside>
        <section className="catalog-admin__editor-panel">
          {!draft ? <div className="catalog-admin__empty"><span className="catalog-admin__empty-mark" aria-hidden="true">+</span><h2>Build a training technique</h2><p>Select one of {packages.length} existing techniques, or create a new catalog item and author each pose by hand.</p><button className="btn btn--light" onClick={() => selectPackage(newPackage())} type="button">Create technique</button></div> : <>
            {workspacePanel !== "pose" ? <div className="catalog-admin__editor-heading"><div><span className="catalog-admin__eyebrow">{packages.some((item) => item.id === draft.id) ? "Editing" : "New item"}</span><h2>{draft.catalog.name || "Untitled catalog item"}</h2></div>{draft.has_tracking ? <span className="catalog-admin__tracking">Tracking package attached</span> : <span className="catalog-admin__tracking">Catalog-only package</span>}</div> : null}
            {draftIssues.length ? <div className="catalog-admin__readiness" role="status"><strong>{draftIssues.length} item{draftIssues.length === 1 ? "" : "s"} before save</strong><span>{draftIssues.slice(0, 3).join(" · ")}</span></div> : null}
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
            <div className="catalog-admin__steps-heading"><div><h3>Steps and angle ranges</h3><p>Keep steps in performance order. Each range feeds scoring and coaching.</p></div><button className="btn btn--ghost btn--small" disabled={draft.training_steps.steps.length >= 12} onClick={addStep} type="button">Add step</button></div>
            <div className="catalog-admin__steps">{draft.training_steps.steps.map((step, stepIndex) => <article className="catalog-admin__step" key={`${step.step_number}-${stepIndex}`}><div className="catalog-admin__step-top"><span>Step {stepIndex + 1}</span><input value={step.step_name} onChange={(event) => updateStep(stepIndex, "step_name", event.target.value)} /><button className="catalog-admin__text-button" disabled={draft.training_steps.steps.length === 1} onClick={() => removeStep(stepIndex)} type="button">Remove step</button></div><div className="catalog-admin__step-meta"><label><span>Striking surface</span><select aria-label={`Step ${stepIndex + 1} striking surface`} onChange={(event) => { const value = event.target.value; updateStep(stepIndex, "striking_surface", value); if (!value) updateStep(stepIndex, "striking_side", ""); }} value={step.striking_surface || ""}>{STRIKING_SURFACES.map((surface) => <option key={surface.value || "none"} value={surface.value}>{surface.label}</option>)}</select></label><label><span>Striking side</span><select aria-label={`Step ${stepIndex + 1} striking side`} disabled={!step.striking_surface} onChange={(event) => updateStep(stepIndex, "striking_side", event.target.value)} value={step.striking_side || ""}><option value="">Select side</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option></select></label><span className={`catalog-admin__step-pose-status ${step.reference_pose ? "has-pose" : "no-pose"}`}>{step.reference_pose ? "Saved reference pose" : "No saved reference pose"}</span>{step.reference_pose ? <button className="catalog-admin__text-button" onClick={() => clearStepReferencePose(stepIndex)} type="button">Clear pose</button> : null}</div><div className="catalog-admin__ranges">{(step.angle_targets || []).map((target, targetIndex) => <div className="catalog-admin__range" key={`${target.body_part}-${targetIndex}`}><input aria-label="Body part" value={target.body_part} onChange={(event) => updateTarget(stepIndex, targetIndex, "body_part", event.target.value)} /><input aria-label="Range label" value={target.label || ""} onChange={(event) => updateTarget(stepIndex, targetIndex, "label", event.target.value)} placeholder="Label" /><input aria-label="Minimum angle" min="0" max="180" type="number" value={target.min} onChange={(event) => updateTarget(stepIndex, targetIndex, "min", Number(event.target.value))} /><span>to</span><input aria-label="Maximum angle" min="0" max="180" type="number" value={target.max} onChange={(event) => updateTarget(stepIndex, targetIndex, "max", Number(event.target.value))} /><button className="catalog-admin__text-button" disabled={step.angle_targets.length === 1} onClick={() => setDraft((current) => { const steps = [...current.training_steps.steps]; steps[stepIndex] = { ...steps[stepIndex], angle_targets: step.angle_targets.filter((_, index) => index !== targetIndex) }; return { ...current, training_steps: { ...current.training_steps, steps } }; })} type="button">×</button></div>)}<button className="catalog-admin__add-range" onClick={() => updateStep(stepIndex, "angle_targets", [...(step.angle_targets || []), newTarget()])} type="button">+ Add angle range</button></div></article>)}</div>
            </section> : null}
            {workspacePanel === "pose" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--pose">
            <ManualPosePanel
              key={`${draft.id || draft.catalog.id || "new"}-${poseEditorRevision}`}
              onApplyManualPose={applyManualPose}
              onManualPoseChange={syncManualPose}
              onReuseEarlierStep={reuseEarlierStep}
              onStepSelect={setPoseStepIndex}
              onTransitionDurationChange={updateTransitionDuration}
              step={draft.training_steps.steps[poseStepIndex]}
              stepIndex={poseStepIndex}
              steps={draft.training_steps.steps}
              timelineCycle={poseCycle}
              transitionDurationMs={poseTransitionDuration}
              transitionTarget={poseTransitionTarget}
            />
            </section> : null}
            {workspacePanel === "guide" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--guide">
              <GuideContentEditor
                content={draft.learning_content}
                onChange={(learningContent) => setDraft((current) => ({ ...current, learning_content: learningContent }))}
                steps={draft.training_steps.steps}
                techniqueId={draft.catalog.id || draft.id}
              />
            </section> : null}
            {workspacePanel === "history" ? <section className="catalog-admin__panel-view catalog-admin__panel-view--history">
              <div className="catalog-admin__steps-heading"><div><h3>Publication history</h3><p>Every publish and rollback creates an immutable database revision.</p></div></div>
              <div className="catalog-admin__steps">{revisions.length ? revisions.map((revision) => <article className="catalog-admin__step" key={revision.id}><div className="catalog-admin__step-top"><strong>Version {revision.version}</strong><span>{new Date(revision.created_at).toLocaleString()}</span><button className="btn btn--ghost btn--small" disabled={isSaving} onClick={() => rollback(revision)} type="button">Restore</button></div><small>{revision.action}</small></article>) : <p>No database publications yet. Publish this technique to create the first revision.</p>}</div>
            </section> : null}
          </>}
        </section>
      </section>
      </section>
    </main>
  );
}
