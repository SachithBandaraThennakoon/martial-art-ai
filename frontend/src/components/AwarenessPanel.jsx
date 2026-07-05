const formatScore = (value) =>
  Number.isFinite(value) ? `${Math.round(value)}%` : "--";

const getScoreClass = (value, goodAt = 70) => {
  if (!Number.isFinite(value)) return "is-waiting";
  return value >= goodAt ? "is-good" : "is-low";
};

function HandCard({ hand, label }) {
  const visible = hand?.visible;
  const closure = hand?.fistScore;
  const openness = Number.isFinite(closure) ? 100 - closure : null;

  return (
    <article className={`awareness-hand ${visible ? "is-visible" : "is-missing"}`}>
      <div className="awareness-card__head">
        <span>{label}</span>
        <strong>{visible ? hand.state : "Not visible"}</strong>
      </div>
      <div className="awareness-bars">
        <div className="awareness-meter">
          <div>
            <span>Fist</span>
            <strong>{formatScore(closure)}</strong>
          </div>
          <i style={{ width: `${Number.isFinite(closure) ? closure : 0}%` }} />
        </div>
        <div className="awareness-meter awareness-meter--blue">
          <div>
            <span>Open</span>
            <strong>{formatScore(openness)}</strong>
          </div>
          <i style={{ width: `${Number.isFinite(openness) ? openness : 0}%` }} />
        </div>
      </div>
    </article>
  );
}

export default function AwarenessPanel({ awareness }) {
  const face = awareness?.face || {};
  const leftHand = awareness?.hands?.left;
  const rightHand = awareness?.hands?.right;

  return (
    <div className="awareness-panel">
      <div className="panel-heading">
        <p className="eyebrow">Awareness</p>
        <span>{awareness?.active ? "Live" : "Starting"}</span>
      </div>

      <article className="awareness-face">
        <div className="awareness-face__main">
          <span>Face</span>
          <strong>{face.visible ? face.focus : "Move face into frame"}</strong>
        </div>
        <div className="awareness-face__grid">
          <div className={getScoreClass(face.forwardScore)}>
            <span>Forward</span>
            <strong>{formatScore(face.forwardScore)}</strong>
          </div>
          <div className={getScoreClass(face.eyeScore)}>
            <span>Eyes</span>
            <strong>{formatScore(face.eyeScore)}</strong>
          </div>
          <div className={getScoreClass(face.calmScore, 55)}>
            <span>Tension</span>
            <strong>{face.visible ? face.expression : "--"}</strong>
          </div>
        </div>
      </article>

      <div className="awareness-hands">
        <HandCard hand={leftHand} label="Left hand" />
        <HandCard hand={rightHand} label="Right hand" />
      </div>
    </div>
  );
}
