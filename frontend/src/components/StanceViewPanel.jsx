const VIEW_OPTIONS = [
  { label: "Front", value: 0 },
  { label: "30°", value: 30 },
  { label: "45°", value: 45 },
  { label: "60°", value: 60 },
  { label: "Side", value: 90 }
];

export default function StanceViewPanel({ onChange, value = 0 }) {
  return (
    <section className="stance-view" aria-label="Stance view target">
      <div className="stance-view__heading">
        <div>
          <p className="eyebrow">Stance view</p>
          <strong>Choose your camera angle</strong>
        </div>
        <span>{value}°</span>
      </div>
      <div className="stance-view__options">
        {VIEW_OPTIONS.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "is-active" : ""}
            key={option.value}
            onClick={() => onChange?.(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <small>{value === 0 ? "Best for guard, posture, and both hands." : value <= 45 ? "Best for fighting stance and hip-shoulder mechanics." : "Use for a dedicated side-view drill."}</small>
      <small className="stance-view__legend"><i className="is-correct" /> Correct target <i className="is-correction" /> Adjust target</small>
    </section>
  );
}
