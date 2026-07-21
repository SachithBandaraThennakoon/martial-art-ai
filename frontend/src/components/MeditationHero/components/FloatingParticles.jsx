import { generateParticles } from "../particleUtils";

const particles = generateParticles(78, 41, "ambient");

export default function FloatingParticles() {
  return (
    <div className="meditation-particles" aria-hidden="true">
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
