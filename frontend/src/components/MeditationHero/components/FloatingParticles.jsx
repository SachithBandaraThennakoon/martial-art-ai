import { generateParticles } from "../particleUtils";

export default function FloatingParticles({
  className = "",
  count = 78,
  seed = 41,
  area = "ambient",
}) {
  const particles = generateParticles(count, seed, area);

  return (
    <div className={`meditation-particles ${className}`.trim()} aria-hidden="true">
      {particles.map((particle) => (
        <i
          className={`meditation-particle meditation-particle--${particle.tone}`}
          key={particle.id}
          style={{
            "--x": `${particle.x}%`,
            "--y": `${particle.y}%`,
            "--size": `${particle.size}px`,
            "--duration": `${particle.duration}s`,
            "--delay": `${particle.delay}s`,
            "--drift": `${particle.drift}px`,
            "--opacity": particle.opacity,
          }}
        />
      ))}
    </div>
  );
}
