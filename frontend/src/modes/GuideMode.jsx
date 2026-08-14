import { useEffect, useState } from "react";
import GuideSkeletonViewer from "../components/GuideSkeletonViewer";
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
  return <section className="guide-mode">
    <header className="guide-mode__hero">
      <div><p className="eyebrow">{isAdminStudio ? "Admin preview · Technique Guide" : "Technique Guide"}</p><h1>Understand the <span>{name}</span></h1><p>{content.overview.summary}</p></div>
      <div className="guide-mode__meta"><span>{difficulty}</span><span>{steps.length} movement phases</span><span>3D reference</span></div>
    </header>
    <div className="guide-mode__main">
      <GuideSkeletonViewer animation={content.animation} steps={steps} />
      <aside className="guide-mode__objectives">
        <p className="eyebrow">Movement objectives</p>
        <ol>{content.overview.objectives.map((objective) => <li key={objective}>{objective}</li>)}</ol>
        <div className="guide-mode__safety"><strong>Practise safely</strong>{content.overview.safety.map((item) => <p key={item}>{item}</p>)}</div>
      </aside>
    </div>
    <section className="guide-mode__science"><div><p className="eyebrow">Movement science</p><h2>What makes the technique work</h2></div><div className="guide-mode__principles">{content.principles.map((principle) => <article key={principle.id}><span>{principle.domain}</span><h3>{principle.title}</h3><p>{principle.explanation}</p>{principle.related_phases.length ? <small>{principle.related_phases.join(" · ").replaceAll("_", " ")}</small> : null}</article>)}</div></section>
    <p className="guide-mode__disclaimer">The 3D sequence is an instructional reference, not a personalized assessment. Camera-derived motion does not directly measure impact force or joint torque.</p>
  </section>;
}
