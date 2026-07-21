import FloatingParticles from "./components/FloatingParticles";
import EnergyRings from "./components/EnergyRings";
import ParticleBody from "./components/ParticleBody";
import HeroContent from "./components/HeroContent";
import FloorWaves from "./components/FloorWaves";
import "./MeditationHero.css";

export default function MeditationHero({ primaryTo = "/register", welcomeName = "", bodyAsset }) {
  return (
    <section className="meditation-hero" aria-labelledby="meditation-hero-title">
      <div className="meditation-hero__grid" aria-hidden="true" />
      <div className="meditation-hero__glow" aria-hidden="true" />
      <FloatingParticles />
      <HeroContent primaryTo={primaryTo} welcomeName={welcomeName} />

      <div className="meditation-hero__visual" aria-hidden="true">
       
        <EnergyRings layer="back" />
        <FloorWaves />
        <ParticleBody assetSrc={bodyAsset} />
        <EnergyRings layer="front" />
        <div className="meditation-hero__platform" />
        
      </div>
    </section>
  );
}
