const points = [
  { name: "crown", y: 7.5, size: 8, color: "#eaf8ff", glow: 24 },
  { name: "brow", y: 25.5, size: 7, color: "#8bcfff", glow: 20 },
  { name: "throat", y: 33.5, size: 7, color: "#77d7ff", glow: 20 },
  { name: "heart", y: 47, size: 9, color: "#8be4bd", glow: 27 },
  { name: "solar", y: 61.5, size: 8, color: "#d8f1ff", glow: 23 },
  { name: "sacral", y: 73, size: 7, color: "#79b8ff", glow: 21 },
  { name: "root", y: 85.5, size: 9, color: "#f4fbff", glow: 28 },
];

export default function EnergyPoints() {
  return (
    <div className="meditation-energy-points" aria-hidden="true">
      {points.map((point, index) => (
        <i
          data-energy-point={point.name}
          key={point.name}
          style={{
            "--point-y": `${point.y}%`,
            "--point-size": `${point.size}px`,
            "--point-color": point.color,
            "--point-glow": `${point.glow}px`,
            "--point-delay": `${index * -0.31}s`,
          }}
        />
      ))}
    </div>
  );
}
