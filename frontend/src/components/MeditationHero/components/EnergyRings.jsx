export default function EnergyRings({ layer = "back" }) {
  if (layer === "front") {
    return (
      <div className="meditation-rings meditation-rings--front" aria-hidden="true">
        <i className="meditation-ring meditation-ring--front-one" />
        <i className="meditation-ring meditation-ring--front-two" />
      </div>
    );
  }

  return (
    <div className="meditation-rings meditation-rings--back" aria-hidden="true">
      <i className="meditation-ring meditation-ring--one" />
      <i className="meditation-ring meditation-ring--two" />
      <i className="meditation-ring meditation-ring--three" />
      <i className="meditation-ring meditation-ring--four" />
      <i className="meditation-wave meditation-wave--one" />
      <i className="meditation-wave meditation-wave--two" />
      <i className="meditation-wave meditation-wave--three" />
      <i className="meditation-wave meditation-wave--four" />
      <i className="meditation-wave meditation-wave--five" />
    </div>
  );
}
