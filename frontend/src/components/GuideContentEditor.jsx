import GuideSkeletonViewer from "./GuideSkeletonViewer";

const DOMAINS = ["kinematics", "kinetics", "balance", "stability", "alignment", "coordination", "footwork", "timing", "safety", "recovery"];

function newLearningContent(techniqueId = "") {
  return {
    schema_version: "1.0",
    technique_id: techniqueId,
    status: "DRAFT",
    overview: { summary: "", objectives: [], safety: [] },
    principles: [],
    animation: {
      source: "training_steps", loop: true, playback_speed: 0.75,
      camera_preset: "front_diagonal", show_trajectory: true, highlight_joints: [],
    },
  };
}

function lines(value) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export default function GuideContentEditor({ content, onChange, steps, techniqueId }) {
  if (!content) {
    return <div className="guide-editor__empty"><p className="eyebrow">Optional learning layer</p><h3>Add a Technique Guide</h3><p>Create a 3D explanation, movement objectives, safety guidance, and reviewed principles. It remains hidden from students until published.</p><button className="btn btn--light" onClick={() => onChange(newLearningContent(techniqueId))} type="button">Create Guide draft</button></div>;
  }

  const updateOverview = (field, value) => onChange({ ...content, overview: { ...content.overview, [field]: value } });
  const updateAnimation = (field, value) => onChange({ ...content, animation: { ...content.animation, [field]: value } });
  const updatePrinciple = (index, field, value) => {
    const principles = [...content.principles];
    principles[index] = { ...principles[index], [field]: value };
    onChange({ ...content, principles });
  };
  const addPrinciple = () => onChange({
    ...content,
    principles: [...content.principles, {
      id: `principle_${content.principles.length + 1}`, domain: "kinematics",
      title: "", explanation: "", related_phases: [],
    }],
  });

  return <div className="guide-editor">
    <div className="guide-editor__preview">
      <GuideSkeletonViewer animation={content.animation} steps={steps} />
      <div className="guide-editor__animation-settings">
        <label>Camera<select value={content.animation.camera_preset} onChange={(event) => updateAnimation("camera_preset", event.target.value)}><option value="front_diagonal">Front diagonal</option><option value="front">Front</option><option value="side">Side</option></select></label>
        <label>Default speed<select value={content.animation.playback_speed} onChange={(event) => updateAnimation("playback_speed", Number(event.target.value))}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.5">1.5×</option></select></label>
        <label className="catalog-admin__checkbox"><input checked={content.animation.show_trajectory} onChange={(event) => updateAnimation("show_trajectory", event.target.checked)} type="checkbox" /> Show hand trajectory</label>
        <label className="guide-editor__wide">Highlighted joints<input value={content.animation.highlight_joints.join(", ")} onChange={(event) => updateAnimation("highlight_joints", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="shoulder_left, elbow_left, wrist_left" /></label>
      </div>
    </div>
    <div className="guide-editor__content">
      <div className="guide-editor__heading"><div><p className="eyebrow">Guide Studio</p><h3>Student learning content</h3></div><label>Status<select value={content.status} onChange={(event) => onChange({ ...content, status: event.target.value })}><option>DRAFT</option><option>IN_REVIEW</option><option>PUBLISHED</option></select></label></div>
      <label>Overview<textarea rows="4" value={content.overview.summary} onChange={(event) => updateOverview("summary", event.target.value)} placeholder="Explain what the technique is and what the learner should notice." /></label>
      <div className="guide-editor__two-columns">
        <label>Objectives <small>One per line</small><textarea rows="5" value={content.overview.objectives.join("\n")} onChange={(event) => updateOverview("objectives", lines(event.target.value))} /></label>
        <label>Safety guidance <small>One per line</small><textarea rows="5" value={content.overview.safety.join("\n")} onChange={(event) => updateOverview("safety", lines(event.target.value))} /></label>
      </div>
      <div className="guide-editor__principles-heading"><div><h3>Movement principles</h3><p>Use kinetics only for carefully qualified force-related explanations.</p></div><button className="btn btn--ghost btn--small" onClick={addPrinciple} type="button">Add principle</button></div>
      <div className="guide-editor__principles">{content.principles.map((principle, index) => <article key={`${principle.id}-${index}`}>
        <div className="guide-editor__principle-top"><input aria-label="Principle title" value={principle.title} onChange={(event) => updatePrinciple(index, "title", event.target.value)} placeholder="Principle title" /><button className="catalog-admin__text-button" onClick={() => onChange({ ...content, principles: content.principles.filter((_, itemIndex) => itemIndex !== index) })} type="button">Remove</button></div>
        <div className="guide-editor__principle-meta"><label>ID<input value={principle.id} onChange={(event) => updatePrinciple(index, "id", event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, ""))} /></label><label>Domain<select value={principle.domain} onChange={(event) => updatePrinciple(index, "domain", event.target.value)}>{DOMAINS.map((domain) => <option key={domain}>{domain}</option>)}</select></label><label>Phases<input value={principle.related_phases.join(", ")} onChange={(event) => updatePrinciple(index, "related_phases", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="extension, recovery" /></label></div>
        <label>Explanation<textarea rows="3" value={principle.explanation} onChange={(event) => updatePrinciple(index, "explanation", event.target.value)} /></label>
      </article>)}</div>
    </div>
  </div>;
}
