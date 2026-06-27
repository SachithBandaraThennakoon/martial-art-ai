// Calculate score (0–100)
export function getScore(value, min, max) {
  if (value >= min && value <= max) return 100;

  const diff = Math.min(
    Math.abs(value - min),
    Math.abs(value - max)
  );

  return Math.max(0, 100 - diff * 2);
}

// Feedback generator
export function getFeedback(value, min, max) {
  if (value < min) {
    const diff = min - value;
    if (diff > 40) return "🔼 Extend your arm more";
    return "🔼 Extend slightly more";
  }

  if (value > max) {
    return "🔽 Reduce angle";
  }

  return "✅ Good";
}