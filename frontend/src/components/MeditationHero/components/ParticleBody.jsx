import { useState } from "react";
import { generateParticles } from "../particleUtils";
import EnergyLine from "./EnergyLine";
import EnergyPoints from "./EnergyPoints";

const bodyParticles = generateParticles(104, 83, "body");
const auraParticles = generateParticles(52, 127, "aura").map((particle, index) => {
  const side = index % 2 === 0 ? -1 : 1;

  return {
    ...particle,
    x: side < 0 ? 2 + particle.x * 0.25 : 73 + particle.x * 0.25,
    y: 7 + particle.y * 0.86,
    drift: side * (20 + Math.abs(particle.drift)),
  };
});

export default function ParticleBody({ assetSrc = "/images/meditation-body-transparent.png" }) {
  const [assetAvailable, setAssetAvailable] = useState(true);

  return (
    <div className={`meditation-body ${assetAvailable ? "meditation-body--asset" : "meditation-body--fallback"}`}>
      <div className="meditation-silhouette" aria-hidden="true">
        <i className="meditation-silhouette__head" />
        <i className="meditation-silhouette__neck" />
        <i className="meditation-silhouette__torso" />
        <i className="meditation-silhouette__arm meditation-silhouette__arm--left" />
        <i className="meditation-silhouette__arm meditation-silhouette__arm--right" />
        <i className="meditation-silhouette__hand" />
        <i className="meditation-silhouette__leg meditation-silhouette__leg--left" />
        <i className="meditation-silhouette__leg meditation-silhouette__leg--right" />
        <i className="meditation-silhouette__base" />
      </div>

      {assetAvailable ? (
        <img
          className="meditation-body__asset"
          src={assetSrc}
          alt=""
          onError={() => setAssetAvailable(false)}
          draggable="false"
        />
      ) : null}

      <div className="meditation-body__particles" aria-hidden="true">
        {bodyParticles.map((particle) => (
          <i
            className={`meditation-particle meditation-particle--${particle.tone}`}
            key={particle.id}
            style={{
              "--x": `${18 + particle.x * 0.64}%`,
              "--y": `${8 + particle.y * 0.82}%`,
              "--size": `${particle.size}px`,
              "--duration": `${particle.duration}s`,
              "--delay": `${particle.delay}s`,
              "--drift": `${particle.x < 50 ? -Math.abs(particle.drift) : Math.abs(particle.drift)}px`,
              "--opacity": particle.opacity,
            }}
          />
        ))}
      </div>

      <div className="meditation-body__aura-particles" aria-hidden="true">
        {auraParticles.map((particle) => (
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

      <EnergyLine />
      <EnergyPoints />
    </div>
  );
}
