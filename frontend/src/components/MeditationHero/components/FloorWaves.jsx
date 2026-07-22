const waves = Array.from({ length: 11 }, (_, index) => ({
  id: `floor-wave-${index}`,
  delay: index * -0.92,
  duration: 9.5 + (index % 4) * 1.15,
  width: 40 + (index % 3) * 4,
  height: 8.5 + (index % 4) * 1.15,
  bottom: 5.0 + (index % 3) * 0.45,
  scale: 2.1 + (index % 3) * 0.16,
  peakOpacity: 0.4 + (index % 4) * 0.06,
}));

export default function FloorWaves() {
  return (
    <div className="meditation-floor-waves" aria-hidden="true">
      {waves.map((wave) => (
        <i
          key={wave.id}
          style={{
            "--floor-delay": `${wave.delay}s`,
            "--floor-duration": `${wave.duration}s`,
            "--floor-width": `${wave.width}%`,
            "--floor-height": `${wave.height}%`,
            "--floor-bottom": `${wave.bottom}%`,
            "--floor-scale": wave.scale,
            "--floor-peak-opacity": wave.peakOpacity,
          }}
        />
      ))}
    </div>
  );
}
