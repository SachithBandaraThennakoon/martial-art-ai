import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import GuideSkeletonViewer from "../components/GuideSkeletonViewer";
import { API_BASE_URL } from "../services/api";

function slugify(value = "") { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function phaseCues(step, objectives) {
  const cues = list(step.key_cues || step.cues);
  if (cues.length) return cues.slice(0, 5);
  const targets = list(step.angle_targets).map((target) => target.label || target.body_part?.replaceAll("_", " ")).filter(Boolean);
  return [...targets, ...objectives].slice(0, 5);
}

function PhaseNavigator({ phases, selected, onSelect }) {
  return <nav className="guide-progress" aria-label="Technique phases">{phases.map((phase, index) => <button aria-current={selected === index ? "step" : undefined} className={selected === index ? "is-active" : ""} key={`${phase.step_number}-${index}`} onClick={() => onSelect(index)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><strong>{phase.step_name}</strong></button>)}</nav>;
}

function ScienceCards({ principles }) {
  const [open, setOpen] = useState(null);
  return <div className="guide-science-list">{principles.map((principle, index) => <article className={open === index ? "is-open" : ""} key={principle.id || index}><button onClick={() => setOpen(open === index ? null : index)} type="button"><span>{principle.domain}</span><strong>{principle.title}</strong><b>{open === index ? "−" : "+"}</b></button>{open === index ? <div><p>{principle.explanation}</p>{list(principle.related_phases).length ? <small>Related phases: {principle.related_phases.join(" · ").replaceAll("_", " ")}</small> : null}</div> : null}</article>)}</div>;
}

export default function GuideMode({ isAdminStudio = false, selectedTechniqueName = "" }) {
  const techniqueId = slugify(selectedTechniqueName);
  const [state, setState] = useState({ status: "loading", data: null, error: "", techniqueId });
  const [selectedPhase, setSelectedPhase] = useState(0);
  const [detailLevel, setDetailLevel] = useState("beginner");
  const [quizAnswers, setQuizAnswers] = useState({});
  const guideRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/techniques/guide/${techniqueId}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Technique Guide is unavailable");
      setSelectedPhase(0);
      setQuizAnswers({});
      setState({ status: "ready", data, error: "", techniqueId });
    }).catch((error) => { if (error.name !== "AbortError") setState({ status: "error", data: null, error: error.message, techniqueId }); });
    return () => controller.abort();
  }, [techniqueId]);

  if (state.status === "loading" || state.techniqueId !== techniqueId) return <section className="guide-mode guide-mode--message"><p>Loading Technique Guide…</p></section>;
  if (state.status === "error") return <section className="guide-mode guide-mode--message"><div><p className="eyebrow">Guide unavailable</p><h2>{selectedTechniqueName}</h2><p>{state.error}. This technique can still be used in Train and Practice.</p></div></section>;

  const { learning_content: apiContent = {}, name, difficulty, steps = [] } = state.data;
  const content = apiContent;
  const overview = content.overview || {};
  const objectives = list(overview.objectives);
  const phases = steps.length ? steps : [{ step_number: 1, step_name: "Reference movement", angle_targets: [], reference_pose: null }];
  const rawPhase = phases[Math.min(selectedPhase, phases.length - 1)];
  const phaseEnhancement = content.phase_lessons?.[slugify(rawPhase.step_name)] || {};
  const phase = { ...rawPhase, ...phaseEnhancement, key_cues: phaseEnhancement.key_cues || rawPhase.key_cues, common_errors: phaseEnhancement.common_errors || rawPhase.common_errors };
  const cues = phaseCues(phase, objectives);
  const measurements = list(phase.angle_targets);
  const errors = [...list(phase.common_errors || phase.errors), ...list(content.common_errors).filter((error) => error.phase === slugify(rawPhase.step_name))];
  const quiz = list(content.knowledge_check || content.knowledgeCheck);
  const purpose = overview.purpose || content.purpose;
  const learningTime = content.learning_time_minutes || content.estimated_minutes;
  const phaseGoal = phase.goal || phase.description || `Build the ${phase.step_name.toLowerCase()} phase with control and a stable base.`;
  const detailItems = detailLevel === "technical" ? list(content.technical_features) : list(content.research_features);
  return <section className="guide-mode" ref={guideRef}>
    <header className="guide-mode__hero guide-mode__hero--progressive"><div><p className="eyebrow">{isAdminStudio ? "Admin preview · Technique Guide" : "Technique Guide"}</p><h1>{name}</h1><p>{overview.summary || state.data.description || "Learn the movement from the complete action through its key phases."}</p>{purpose ? <p className="guide-mode__purpose"><strong>Purpose</strong>{purpose}</p> : null}<button className="btn btn--light" onClick={() => document.querySelector(".guide-skeleton")?.scrollIntoView({ behavior: "smooth", block: "center" })} type="button">Watch Full Movement</button></div><div className="guide-mode__meta"><span>{difficulty}</span><span>{phases.length} phases</span><span>{learningTime ? `~${learningTime} min guide` : "Progressive guide"}</span></div></header>
    <section className="guide-mode__understand"><div className="guide-mode__section-heading"><div><p className="eyebrow">Understand</p><h2>See the whole movement first</h2></div><span>Step {Math.min(selectedPhase + 1, phases.length)} of {phases.length}</span></div><PhaseNavigator phases={phases} selected={selectedPhase} onSelect={setSelectedPhase} /><div className="guide-mode__main"><GuideSkeletonViewer animation={content.animation || {}} onPhaseChange={setSelectedPhase} selectedPhaseIndex={selectedPhase} steps={steps} /><aside className="guide-mode__objectives"><p className="eyebrow">Movement objectives</p><ol>{objectives.map((objective) => <li key={objective}>{objective}</li>)}</ol><div className="guide-mode__safety"><strong>Practise safely</strong>{list(overview.safety).map((item) => <p key={item}>{item}</p>)}</div></aside></div></section>
    <section className="guide-mode__phase-lesson"><div className="guide-mode__section-heading"><div><p className="eyebrow">Learn one phase at a time</p><h2>Step {Math.min(selectedPhase + 1, phases.length)} of {phases.length}: {phase.step_name}</h2></div><div className="guide-mode__phase-actions"><button disabled={selectedPhase === 0} onClick={() => setSelectedPhase((value) => Math.max(0, value - 1))} type="button">Previous Phase</button><button disabled={selectedPhase >= phases.length - 1} onClick={() => setSelectedPhase((value) => Math.min(phases.length - 1, value + 1))} type="button">Next Phase</button></div></div><div className="guide-mode__lesson-grid"><article><span className="eyebrow">Goal</span><p>{phaseGoal}</p>{phase.remember ? <small><b>Remember:</b> {phase.remember}</small> : null}{phase.why_it_matters ? <small><b>Why it matters:</b> {phase.why_it_matters}</small> : null}</article><article><span className="eyebrow">Focus on</span>{cues.length ? <ul>{cues.map((cue) => <li key={cue}>{cue}</li>)}</ul> : <p>Follow the reference phase and keep the movement controlled.</p>}</article>{list(phase.body_cues).length ? <article><span className="eyebrow">Body cues</span><ul>{phase.body_cues.map((cue) => <li key={cue}>{cue}</li>)}</ul></article> : null}{list(phase.what_to_feel).length ? <article><span className="eyebrow">What to feel</span><ul>{phase.what_to_feel.map((cue) => <li key={cue}>{cue}</li>)}</ul></article> : null}{list(phase.avoid).length ? <article><span className="eyebrow">Avoid</span><ul>{phase.avoid.map((cue) => <li key={cue}>{cue}</li>)}</ul></article> : null}</div>{phase.transition_condition ? <p className="guide-mode__transition"><b>Transition when:</b> {phase.transition_condition}</p> : null}</section>
    {errors.length ? <section className="guide-mode__errors"><div className="guide-mode__section-heading"><div><p className="eyebrow">Recognize mistakes</p><h2>Correct the highest-priority issue first</h2></div><span>Safety → control → coverage → alignment → efficiency</span></div><div className="guide-mode__error-grid">{errors.map((error, index) => <article key={error.title || error.name || index}><span className="guide-error__priority">{error.priority || "movement quality"}</span><strong>{error.title || error.name || "Common error"}</strong><p>{error.description || error.why || error.explanation}</p>{list(error.affected_objectives).length ? <small><b>Affects:</b> {error.affected_objectives.join(" · ")}</small> : null}{error.correction ? <small><b>Correction:</b> {error.correction}</small> : null}</article>)}</div></section> : null}
    <section className="guide-mode__science"><div className="guide-mode__section-heading"><div><p className="eyebrow">Why it works</p><h2>Movement science</h2></div><span>Expand a concept</span></div><ScienceCards principles={list(content.principles)} /></section>
    <section className="guide-mode__technical"><div className="guide-mode__section-heading"><div><p className="eyebrow">Progressive disclosure</p><h2>Technical details</h2></div><div className="guide-mode__view-switcher" role="tablist">{["beginner", "technical", "research"].map((level) => <button aria-selected={detailLevel === level} className={detailLevel === level ? "is-active" : ""} key={level} onClick={() => setDetailLevel(level)} role="tab" type="button">{level[0].toUpperCase() + level.slice(1)}</button>)}</div></div>{detailLevel === "beginner" ? <p className="guide-mode__technical-note">Start with goals, cues, errors, and safety. Measurements are available when you are ready.</p> : <><div className="guide-mode__measurement-grid">{measurements.length ? measurements.map((measurement, index) => <article key={`${measurement.body_part}-${index}`}><span>{measurement.label || measurement.body_part?.replaceAll("_", " ")}</span><strong>{measurement.min != null && measurement.max != null ? `${measurement.min}°–${measurement.max}°` : "Reference available"}</strong><small>{phase.step_name}</small></article>) : <p>No technical measurements are available for this phase.</p>}</div>{detailItems.length ? <div className="guide-mode__detail-list">{detailItems.map((item) => <article key={item.label}><strong>{item.label}</strong><p>{item.detail}</p></article>)}</div> : null}</>}</section>
    {quiz.length ? <section className="guide-mode__knowledge"><p className="eyebrow">Quick knowledge check</p><h2>Before you practise</h2>{quiz.slice(0, 5).map((question, index) => { const answer = quizAnswers[index]; const selectedOption = list(question.options).find((option) => (option.id || option.label || option.text || option) === answer); return <article key={question.id || index}><strong>{question.question}</strong><div>{list(question.options).map((option) => { const label = option.label || option.text || option; const isSelected = answer === (option.id || label); return <button aria-pressed={isSelected} className={isSelected ? (option.correct ? "is-correct" : "is-incorrect") : ""} key={option.id || label} onClick={() => setQuizAnswers((current) => ({ ...current, [index]: option.id || label }))} type="button">{label}</button>; })}</div>{answer ? <small>{selectedOption?.correct ? (question.feedback || selectedOption.feedback || "Correct.") : (selectedOption?.feedback || "Review the phase cues and try again.")}</small> : null}</article>; })}</section> : null}
    <section className="guide-mode__rehearsal"><div><p className="eyebrow">Shadow rehearsal</p><h2>Try the movement without scoring</h2>{list(content.shadow_rehearsal?.rounds).length ? <ol>{content.shadow_rehearsal.rounds.map((round) => <li key={round}>{round}</li>)}</ol> : <p>Replay the read-only reference, then move into guided training when you are ready for feedback.</p>}{content.shadow_rehearsal?.instruction ? <p>{content.shadow_rehearsal.instruction}</p> : null}</div><Link className="btn btn--light" to={`/training?technique=${encodeURIComponent(name)}&mode=train`}>Start Guided Training</Link></section>
    <p className="guide-mode__disclaimer">The reference shows visible motion and pose relationships. It does not directly measure impact force, internal muscle force, or joint torque.</p>
  </section>;
}
