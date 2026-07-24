export function scorePracticeAngles(requiredParts, liveAngles) {
  if (!requiredParts.length) {
    return {
      accuracy: 0,
      focusBodyPart: null,
      issue: "needs_targets",
      wrongBodyParts: []
    };
  }

  const partScores = [];
  let worst = null;
  const wrongBodyParts = [];

  requiredParts.forEach((part) => {
    const value = liveAngles?.[part.body_part];

    if (!Number.isFinite(value)) {
      partScores.push(0);
      worst = worst || {
        bodyPart: part.body_part,
        issue: "missing",
        severity: 100
      };
      wrongBodyParts.push(part.body_part);
      return;
    }

    let diff = 0;
    let issue = "good";
    if (value < part.min) {
      diff = part.min - value;
      issue = "too_closed";
    } else if (value > part.max) {
      diff = value - part.max;
      issue = "too_open";
    }

    partScores.push(Math.max(0, 100 - diff * 2));
    if (issue !== "good") wrongBodyParts.push(part.body_part);
    if (!worst || diff > worst.severity) {
      worst = { bodyPart: part.body_part, issue, severity: diff };
    }
  });

  const averageScore =
    partScores.reduce((total, value) => total + value, 0) /
    requiredParts.length;
  const weakestScore = Math.min(...partScores);

  return {
    // A failed critical joint must not be hidden by unrelated targets that
    // happen to score 100.
    accuracy: Math.round(Math.min(averageScore, weakestScore)),
    focusBodyPart: worst?.bodyPart || null,
    issue: worst?.issue || "good",
    wrongBodyParts
  };
}
