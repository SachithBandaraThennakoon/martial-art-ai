const waves = Array.from({ length: 7 }, (_, index) => ({
  id: `floor-wave-${index}`,
  delay: index * -1.35,
  duration: 9.4 + (index % 3) * 1.2,
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
          }}
        />
      ))}
    </div>
  );
}
