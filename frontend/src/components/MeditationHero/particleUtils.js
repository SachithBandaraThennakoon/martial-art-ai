// Seeded generation keeps the server/client markup stable and avoids reflow.
export function generateParticles(count, seed = 19, area = "ambient") {
  let value = seed;
  const random = () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };

  return Array.from({ length: count }, (_, index) => ({
    id: `${area}-${index}`,
    x: Math.round(random() * 1000) / 10,
    y: Math.round(random() * 1000) / 10,
    size: Math.round((1 + random() * (area === "body" ? 3.8 : 3)) * 10) / 10,
    duration: Math.round((8 + random() * 14) * 10) / 10,
    delay: Math.round(random() * -18 * 10) / 10,
    drift: Math.round((random() * 2 - 1) * (area === "body" ? 22 : 54)),
    opacity: Math.round((0.22 + random() * 0.7) * 100) / 100,
    tone: random() > 0.72 ? "green" : random() > 0.45 ? "blue" : "white",
  }));
}
