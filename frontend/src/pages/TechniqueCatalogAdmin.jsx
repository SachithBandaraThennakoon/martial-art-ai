import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import PoseRangeDesigner from "../components/PoseRangeDesigner";

const PLAN_OPTIONS = ["FREE_PLAN", "STARTER_PLAN", "PRO_PLAN", "ELITE_PLAN"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
const REVIEW_STATES = ["DRAFT", "IN_REVIEW", "PUBLISHED"];
const SOURCE_MODES = ["camera_proxy", "model_estimate", "sensor"];
const BIOMECHANICS_PRESETS = [
  ["joint_position", "Joint position", "kinematics", "camera_proxy", "normalized_camera", "Pose landmark position after camera normalization"],
  ["joint_velocity", "Joint velocity", "kinematics", "camera_proxy", "normalized_units_per_second", "Change in landmark position divided by time"],
  ["joint_acceleration", "Joint acceleration", "kinematics", "camera_proxy", "normalized_units_per_second_squared", "Change in landmark velocity divided by time"],
  ["joint_angular_velocity", "Joint angular velocity", "kinematics", "camera_proxy", "degrees_per_second", "Change in joint angle divided by time"],
  ["joint_angular_acceleration", "Joint angular acceleration", "kinematics", "camera_proxy", "degrees_per_second_squared", "Change in angular velocity divided by time"],
  ["center_of_mass_proxy", "Center of mass proxy", "balance", "camera_proxy", "normalized_camera", "Weighted segment-center proxy from visible pose landmarks"],
  ["base_of_support", "Base of support", "balance", "camera_proxy", "normalized_camera", "Support area estimated from visible foot landmarks"],
  ["dynamic_stability", "Dynamic stability", "stability", "camera_proxy", "score", "Center-of-mass support offset combined with movement energy"],
  ["body_alignment", "Body alignment", "alignment", "camera_proxy", "degrees", "Joint and segment angle comparison against target posture"],
  ["weight_distribution_proxy", "Weight distribution proxy", "balance", "camera_proxy", "score", "Visible stance and support-leg loading proxy; not force measurement"],
  ["symmetry", "Left-right symmetry", "alignment", "camera_proxy", "score", "Comparison of left and right segment geometry"],
  ["coordination", "Coordination", "coordination", "camera_proxy", "milliseconds", "Timing relationship between named body segments"],
  ["footwork_dynamics", "Footwork dynamics", "footwork", "camera_proxy", "normalized_units_per_second", "Foot displacement, cadence, pivot, and stance geometry"],
  ["linear_momentum_proxy", "Linear momentum proxy", "kinetics", "model_estimate", "relative_score", "Estimated segment mass model multiplied by observed velocity"],
  ["angular_momentum_proxy", "Angular momentum proxy", "kinetics", "model_estimate", "relative_score", "Estimated segment inertia model multiplied by angular velocity"],
  ["joint_torque", "Joint torque estimate", "kinetics", "model_estimate", "newton_meters", "Segment mass and acceleration model; requires stated assumptions"],
  ["energy_transfer_proxy", "Energy transfer proxy", "efficiency", "model_estimate", "relative_score", "Kinematic-chain timing and velocity transfer model"],
  ["ground_reaction_force", "Ground reaction force", "kinetics", "sensor", "newtons", "Force plate or pressure-sensor measurement"],
  ["center_of_pressure", "Center of pressure", "balance", "sensor", "normalized_foot_coordinates", "Pressure mat or insole measurement"],
  ["impulse", "Impulse", "impact", "sensor", "newton_seconds", "Measured force integrated across contact time"],
  ["collision_impact", "Collision and impact", "impact", "sensor", "newtons", "Impact sensor or instrumented target measurement"],
  ["friction", "Foot-ground friction", "impact", "sensor", "coefficient", "Force and surface measurement"],
];

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function newTarget() {
  return { body_part: "elbow_left", label: "Elbow alignment", target_angle: 90, min: 70, max: 110, role: "primary", weight: 1 };
}

function newStep(number) {
  return { step_number: number, step_name: `Step ${number}`, angle_targets: [newTarget()] };
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

export default function TechniqueCatalogAdmin() {
  const [packages, setPackages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [poseStepIndex, setPoseStepIndex] = useState(0);
  const [metricToAdd, setMetricToAdd] = useState(BIOMECHANICS_PRESETS[0][0]);

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
  const filteredPackages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return packages;
    return packages.filter((item) => [item.catalog.name, item.catalog.category, item.catalog.subcategory, item.id]
      .some((value) => String(value || "").toLowerCase().includes(normalized)));
  }, [packages, query]);

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
  const updateBiomechanics = (field, value) => setDraft((current) => ({
    ...current,
    training_steps: { ...current.training_steps, biomechanics: { ...newBiomechanics(), ...current.training_steps.biomechanics, [field]: value } }
  }));
  const updateMetric = (metricIndex, field, value) => setDraft((current) => {
    const biomechanics = { ...newBiomechanics(), ...current.training_steps.biomechanics };
    const measurements = [...biomechanics.measurements];
    measurements[metricIndex] = { ...measurements[metricIndex], [field]: value };
    return { ...current, training_steps: { ...current.training_steps, biomechanics: { ...biomechanics, measurements } } };
  });
  const addMetric = () => setDraft((current) => {
    const preset = BIOMECHANICS_PRESETS.find(([id]) => id === metricToAdd);
    const biomechanics = { ...newBiomechanics(), ...current.training_steps.biomechanics };
    if (!preset || biomechanics.measurements.some((metric) => metric.id === preset[0])) return current;
    const [id, name, domain, source_mode, unit, formula] = preset;
    return { ...current, training_steps: { ...current.training_steps, biomechanics: { ...biomechanics, measurements: [...biomechanics.measurements, { id, name, domain, source_mode, unit, formula, phases: [] }] } } };
  });

  const selectPackage = (item) => {
    setStatus({ type: "", message: "" });
    const editable = clone(item);
    editable.training_steps.biomechanics = { ...newBiomechanics(), ...editable.training_steps.biomechanics };
    setDraft(editable);
    setPoseStepIndex(0);
  };

  const addStep = () => setDraft((current) => {
    const steps = current.training_steps.steps;
    if (steps.length >= 3) return current;
    return { ...current, training_steps: { ...current.training_steps, steps: [...steps, newStep(steps.length + 1)] } };
  });

  const removeStep = (stepIndex) => setDraft((current) => {
    if (current.training_steps.steps.length === 1) return current;
    const steps = current.training_steps.steps.filter((_, index) => index !== stepIndex)
      .map((step, index) => ({ ...step, step_number: index + 1 }));
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });

  const applyPoseRanges = (targets, referencePose) => setDraft((current) => {
    const steps = [...current.training_steps.steps];
    const step = steps[poseStepIndex];
    const existing = new Map((step.angle_targets || []).map((target) => [target.body_part, target]));
    targets.forEach((target) => {
      const currentTarget = existing.get(target.body_part);
      existing.set(target.body_part, {
        ...target,
        label: currentTarget?.label || target.label,
        role: currentTarget?.role || target.role,
        weight: currentTarget?.weight ?? target.weight
      });
    });
    steps[poseStepIndex] = { ...step, angle_targets: [...existing.values()], reference_pose: referencePose };
    return { ...current, training_steps: { ...current.training_steps, steps } };
  });

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
      {status.message ? <p className={`catalog-admin__notice catalog-admin__notice--${status.type}`}>{status.message}</p> : null}
      <section className="catalog-admin__workspace">
        <aside className="catalog-admin__list-panel">
          <div className="catalog-admin__sidebar-header"><div><strong>Catalog studio</strong><span>{filteredPackages.length} items · {categories.length} categories</span></div><button className="btn btn--light btn--small" onClick={() => selectPackage(newPackage())} type="button">New</button></div>
          <label className="catalog-admin__search">Search <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jab, Punching, mobility…" /></label>
          <div className="catalog-admin__list">
            {isLoading ? <p>Loading catalog…</p> : filteredPackages.map((item) => <button className={`catalog-admin__item ${draft?.id === item.id ? "is-selected" : ""}`} key={item.id} onClick={() => selectPackage(item)} type="button"><strong>{item.catalog.name}</strong><span>{item.catalog.category} · {item.catalog.subcategory}</span><em>{item.enabled ? "Active" : "Archived"}</em></button>)}
          </div>
        </aside>
        <section className="catalog-admin__editor-panel">
          {!draft ? <div className="catalog-admin__empty"><h2>Select an item</h2><p>Choose a catalog item to edit it, or create a new one.</p></div> : <>
            <div className="catalog-admin__editor-heading"><div><span className="catalog-admin__eyebrow">{packages.some((item) => item.id === draft.id) ? "Editing" : "New item"}</span><h2>{draft.catalog.name || "Untitled catalog item"}</h2></div>{draft.has_tracking ? <span className="catalog-admin__tracking">Tracking package attached</span> : <span className="catalog-admin__tracking">Catalog-only package</span>}</div>
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
            <section className="catalog-admin__biomechanics">
              <div className="catalog-admin__biomechanics-heading"><div><span className="catalog-admin__eyebrow">Advanced analysis</span><h3>Biomechanics and review</h3><p>Define what is observed, estimated, or measured by a sensor before publishing analysis rules.</p></div><label>Review status<select onChange={(event) => updateBiomechanics("review_status", event.target.value)} value={draft.training_steps.biomechanics?.review_status || "DRAFT"}>{REVIEW_STATES.map((state) => <option key={state}>{state}</option>)}</select></label></div>
              <div className="catalog-admin__biomechanics-actions"><label>Add metric<select onChange={(event) => setMetricToAdd(event.target.value)} value={metricToAdd}>{BIOMECHANICS_PRESETS.map(([id, name, domain, source]) => <option key={id} value={id}>{name} · {domain} · {source}</option>)}</select></label><button className="btn btn--ghost btn--small" onClick={addMetric} type="button">Add measurement</button><label>Reviewed by<input onChange={(event) => updateBiomechanics("reviewed_by", event.target.value)} placeholder="Reviewer name" value={draft.training_steps.biomechanics?.reviewed_by || ""} /></label></div>
              <div className="catalog-admin__metric-list">{(draft.training_steps.biomechanics?.measurements || []).length ? draft.training_steps.biomechanics.measurements.map((metric, metricIndex) => <article className="catalog-admin__metric" key={metric.id}><div className="catalog-admin__metric-title"><strong>{metric.name}</strong><span>{metric.id}</span><button className="catalog-admin__text-button" onClick={() => setDraft((current) => { const biomechanics = { ...newBiomechanics(), ...current.training_steps.biomechanics }; return { ...current, training_steps: { ...current.training_steps, biomechanics: { ...biomechanics, measurements: biomechanics.measurements.filter((_, index) => index !== metricIndex) } } }; })} type="button">Remove</button></div><div className="catalog-admin__metric-grid"><label>Source<select onChange={(event) => updateMetric(metricIndex, "source_mode", event.target.value)} value={metric.source_mode}>{SOURCE_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select></label><label>Unit<input onChange={(event) => updateMetric(metricIndex, "unit", event.target.value)} value={metric.unit} /></label><label>Target<input onChange={(event) => updateMetric(metricIndex, "target", event.target.value)} type="number" value={metric.target ?? ""} /></label><label>Min<input onChange={(event) => updateMetric(metricIndex, "min", event.target.value)} type="number" value={metric.min ?? ""} /></label><label>Max<input onChange={(event) => updateMetric(metricIndex, "max", event.target.value)} type="number" value={metric.max ?? ""} /></label><label className="catalog-admin__metric-formula">Formula / assumption<input onChange={(event) => updateMetric(metricIndex, "formula", event.target.value)} value={metric.formula} /></label></div></article>) : <p className="catalog-admin__metric-empty">Add only metrics your available camera, model, or sensors can support.</p>}</div>
            </section>
            <div className="catalog-admin__steps-heading"><div><h3>Steps and angle ranges</h3><p>Keep steps in performance order. Each range feeds scoring and coaching.</p></div><button className="btn btn--ghost btn--small" disabled={draft.training_steps.steps.length >= 3} onClick={addStep} type="button">Add step</button></div>
            <div className="pose-designer__step-select"><label>Apply pose to <select onChange={(event) => setPoseStepIndex(Number(event.target.value))} value={poseStepIndex}>{draft.training_steps.steps.map((step, index) => <option key={step.step_number} value={index}>Step {index + 1}: {step.step_name}</option>)}</select></label></div>
            <PoseRangeDesigner
              key={draft.training_steps.steps[poseStepIndex]?.step_number}
              onApply={applyPoseRanges}
              rangeTargets={draft.training_steps.steps[poseStepIndex]?.angle_targets || []}
              referencePose={draft.training_steps.steps[poseStepIndex]?.reference_pose || null}
            />
            <div className="catalog-admin__steps">{draft.training_steps.steps.map((step, stepIndex) => <article className="catalog-admin__step" key={`${step.step_number}-${stepIndex}`}><div className="catalog-admin__step-top"><span>Step {stepIndex + 1}</span><input value={step.step_name} onChange={(event) => updateStep(stepIndex, "step_name", event.target.value)} /><button className="catalog-admin__text-button" disabled={draft.training_steps.steps.length === 1} onClick={() => removeStep(stepIndex)} type="button">Remove step</button></div><div className="catalog-admin__ranges">{(step.angle_targets || []).map((target, targetIndex) => <div className="catalog-admin__range" key={`${target.body_part}-${targetIndex}`}><input aria-label="Body part" value={target.body_part} onChange={(event) => updateTarget(stepIndex, targetIndex, "body_part", event.target.value)} /><input aria-label="Range label" value={target.label || ""} onChange={(event) => updateTarget(stepIndex, targetIndex, "label", event.target.value)} placeholder="Label" /><input aria-label="Minimum angle" min="0" max="180" type="number" value={target.min} onChange={(event) => updateTarget(stepIndex, targetIndex, "min", Number(event.target.value))} /><span>to</span><input aria-label="Maximum angle" min="0" max="180" type="number" value={target.max} onChange={(event) => updateTarget(stepIndex, targetIndex, "max", Number(event.target.value))} /><button className="catalog-admin__text-button" disabled={step.angle_targets.length === 1} onClick={() => setDraft((current) => { const steps = [...current.training_steps.steps]; steps[stepIndex] = { ...steps[stepIndex], angle_targets: step.angle_targets.filter((_, index) => index !== targetIndex) }; return { ...current, training_steps: { ...current.training_steps, steps } }; })} type="button">×</button></div>)}<button className="catalog-admin__add-range" onClick={() => updateStep(stepIndex, "angle_targets", [...(step.angle_targets || []), newTarget()])} type="button">+ Add angle range</button></div></article>)}</div>
            <div className="catalog-admin__actions"><button className="btn btn--ghost" onClick={() => setDraft(null)} type="button">Cancel</button>{packages.some((item) => item.id === draft.id) ? <button className="btn btn--danger" onClick={archive} type="button">Archive</button> : null}<button className="btn btn--light" disabled={isSaving} onClick={save} type="button">{isSaving ? "Saving…" : "Save catalog item"}</button></div>
          </>}
        </section>
      </section>
      </section>
    </main>
  );
}
