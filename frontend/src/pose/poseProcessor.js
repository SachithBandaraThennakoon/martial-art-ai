import { getScore, getFeedback } from "../utils/angleEngine";

// Example function
export function evaluateStep(rules, currentAngles) {
  let totalScore = 0;
  let results = [];

  rules.forEach(rule => {
    const value = currentAngles[rule.body_part] || 0;

    const score = getScore(value, rule.min_angle, rule.max_angle);
    const feedback = getFeedback(value, rule.min_angle, rule.max_angle);

    totalScore += score;

    results.push({
      body_part: rule.body_part,
      value,
      min: rule.min_angle,
      max: rule.max_angle,
      feedback
    });
  });

  const accuracy = results.length
    ? Math.round(totalScore / results.length)
    : 0;

  return { results, accuracy };
}