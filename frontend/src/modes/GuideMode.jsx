import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/api";

function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function GuideMode({ isAdminStudio = false, selectedTechniqueName = "" }) {
  const techniqueId = slugify(selectedTechniqueName);
  const [state, setState] = useState({ status: "loading", data: null, error: "", techniqueId });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/techniques/guide/${techniqueId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Technique Guide is unavailable");
        setState({ status: "ready", data, error: "", techniqueId });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", data: null, error: error.message, techniqueId });
      });
    return () => controller.abort();
  }, [techniqueId]);

  if (state.status === "loading" || state.techniqueId !== techniqueId) return <section className="guide-mode guide-mode--message"><p>Loading Technique Guide…</p></section>;
  if (state.status === "error") return <section className="guide-mode guide-mode--message"><div><p className="eyebrow">Guide unavailable</p><h2>{selectedTechniqueName}</h2><p>{state.error}. This technique can still be used in Train and Practice.</p></div></section>;

  const { learning_content: content, name, difficulty, steps } = state.data;
  const guideSteps = steps.filter((step) => step.reference_pose?.landmarks);
  const checkpoints = steps.flatMap((step) => (step.angle_targets || []).map((target) => ({ ...target, stepName: step.step_name }))).slice(0, 6);
  return <section className="guide-mode">
    <header className="guide-mode__hero">
      <div><p className="eyebrow">{isAdminStudio ? "Admin preview · Technique Guide" : "Technique Guide"}</p><h1>Understand the <span>{name}</span></h1><p>{content.overview.summary}</p></div>
      <div className="guide-mode__meta"><span>{difficulty}</span><span>{steps.length} movement phases</span><span>3D reference</span></div>
    </header>
    <div className="guide-mode__main guide-mode__main--text-only">
      <aside className="guide-mode__objectives">
        <p className="eyebrow">Movement objectives</p>
        <ol>{content.overview.objectives.map((objective) => <li key={objective}>{objective}</li>)}</ol>
        <div className="guide-mode__safety"><strong>Practise safely</strong>{content.overview.safety.map((item) => <p key={item}>{item}</p>)}</div>
      </aside>
    </div>
    <section className="guide-mode__learning-path" aria-label="Guide learning path"><div className="guide-mode__learning-heading"><div><p className="eyebrow">Learn the sequence</p><h2>Use the guide in three passes</h2></div><span className="guide-mode__readonly-badge">Read-only reference</span></div><div className="guide-mode__learning-cards"><article><span>01</span><div><h3>Observe</h3><p>Play the 3D reference and rotate the space to understand the complete movement.</p></div></article><article><span>02</span><div><h3>Rehearse</h3><p>Follow the phases in order, keeping the highlighted joints and trajectory in view.</p></div></article><article><span>03</span><div><h3>Check</h3><p>Move to Train when you are ready for live guidance and personalized feedback.</p></div></article></div></section>
    {guideSteps.length ? <section className="guide-mode__phases" aria-label="Movement phases"><div className="guide-mode__section-heading"><div><p className="eyebrow">Movement map</p><h2>Follow each phase</h2></div><span>{guideSteps.length} animated reference{guideSteps.length === 1 ? "" : "s"}</span></div><div className="guide-mode__phase-list">{guideSteps.map((step, index) => <article key={`${step.step_number}-${step.step_name}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.step_name}</strong><small>{step.striking_surface ? `${step.striking_surface}${step.striking_side ? ` · ${step.striking_side}` : ""}` : "Reference phase"}</small></div></article>)}</div></section> : null}
    {checkpoints.length ? <section className="guide-mode__checkpoints" aria-label="Technique checkpoints"><div><p className="eyebrow">Form checkpoints</p><h2>What to notice</h2></div><div className="guide-mode__checkpoint-grid">{checkpoints.map((target, index) => <article key={`${target.stepName}-${target.body_part}-${index}`}><strong>{target.label || target.body_part.replaceAll("_", " ")}</strong><span>{target.min}°–{target.max}°</span><small>{target.stepName}</small></article>)}</div></section> : null}
    <section className="guide-mode__science"><div><p className="eyebrow">Movement science</p><h2>What makes the technique work</h2></div><div className="guide-mode__principles">{content.principles.map((principle) => <article key={principle.id}><span>{principle.domain}</span><h3>{principle.title}</h3><p>{principle.explanation}</p>{principle.related_phases.length ? <small>{principle.related_phases.join(" · ").replaceAll("_", " ")}</small> : null}</article>)}</div></section>
    <p className="guide-mode__disclaimer">The 3D sequence is an instructional reference, not a personalized assessment. Camera-derived motion does not directly measure impact force or joint torque.</p>
  </section>;
}
