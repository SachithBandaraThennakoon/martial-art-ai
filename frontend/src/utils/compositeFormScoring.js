const DEFAULT_PROFILES = {
  easy: { tolerance_scale: 1.5, correction_limit: 1 },
  medium: { tolerance_scale: 1, correction_limit: 2 },
  hard: { tolerance_scale: 0.75, correction_limit: 3 }
};

function angleGroup(target) {
  if (target.role === "primary") return "primary";
  if (/knee|ankle/.test(target.body_part)) return "balance";
  if (/hip|shoulder/.test(target.body_part)) return "power";
  return "alignment";
}

export function correctionUrgency(item, feedbackPriority = []) {
  const priorityIndex = feedbackPriority.indexOf(
    item.body_part || item.feature
  );
  const priorityBoost = priorityIndex === -1
    ? 0
    : Math.max(0, feedbackPriority.length - priorityIndex) * 2;
  const severity = Math.max(0, 100 - item.score);

  return (Number(item.weight) || 1) * severity + priorityBoost;
}

function scoreAngle(target, value, toleranceScale) {
  const ideal =
    target.target_angle ?? Math.round((Number(target.min) + Number(target.max)) / 2);
  const lowerTolerance = Math.max(1, ideal - target.min) * toleranceScale;
  const upperTolerance = Math.max(1, target.max - ideal) * toleranceScale;
  const low = ideal - lowerTolerance;
  const high = ideal + upperTolerance;
  const distance = Math.abs(value - ideal);
  const allowedDistance = value < ideal ? lowerTolerance : upperTolerance;
  const score = distance <= allowedDistance
    ? 100 - (distance / allowedDistance) * 20
    : Math.max(0, 80 - ((distance - allowedDistance) / allowedDistance) * 80);

  return {
    score,
    ideal,
    low,
    high,
    issue: value < low ? "increase" : value > high ? "decrease" : null,
    deviation: Math.round(value - ideal)
  };
}

function scoreFeature(target, value, toleranceScale) {
  const threshold = Number(target.value);
  if (!Number.isFinite(threshold)) return { score: 100, issue: null };
  const normalizer = Math.max(Math.abs(threshold), 0.1) * toleranceScale;
  let difference = 0;
  if (target.operator === "gte") difference = Math.max(0, threshold - value);
  if (target.operator === "lte") difference = Math.max(0, value - threshold);
  if (target.operator === "between") {
    difference = value < target.min
      ? target.min - value
      : value > target.max
        ? value - target.max
        : 0;
  }
  return {
    score: Math.max(0, 100 - (difference / normalizer) * 100),
    issue: difference > 0 ? "adjust" : null
  };
}

export function scoreCompositeForm({
  angleTargets = [],
  difficulty = "medium",
  difficultyProfiles,
  liveAngles = {},
  liveFeatures = {},
  nonAngleTargets = [],
  qualityTargets = [],
  feedbackPriority = []
}) {
  const profile = {
    ...(DEFAULT_PROFILES[difficulty] || DEFAULT_PROFILES.medium),
    ...(difficultyProfiles?.[difficulty] || {})
  };
  const evidence = [];

  angleTargets.forEach((target) => {
    const value = liveAngles[target.body_part];
    const group = angleGroup(target);
    // Every configured body angle contributes equally by default. A technique
    // may still provide an explicit weight when biomechanics require it.
    const weight = Number(target.weight) || 1;
    if (!Number.isFinite(value)) {
      evidence.push({ ...target, group, kind: "angle", measured: false, weight });
      return;
    }
    const result = scoreAngle(target, value, profile.tolerance_scale);
    evidence.push({
      ...target,
      ...result,
      group,
      kind: "angle",
      measured: true,
      value: Math.round(value),
      weight
    });
  });

  nonAngleTargets.forEach((target) => {
    const value = liveFeatures[target.feature];
    const weight = target.weight || 1;
    if (!Number.isFinite(value)) {
      evidence.push({ ...target, group: "motion", kind: "feature", measured: false, weight });
      return;
    }
    const result = scoreFeature(target, value, profile.tolerance_scale);
    evidence.push({
      ...target,
      ...result,
      group: "motion",
      kind: "feature",
      measured: true,
      value,
      weight
    });
  });

  qualityTargets.forEach((target) => {
    const value = liveAngles[target.feature];
    const weight = target.weight || 1;
    if (!Number.isFinite(value)) {
      evidence.push({
        ...target,
        group: target.group || "focus",
        kind: "quality",
        measured: false,
        weight
      });
      return;
    }
    const result = scoreAngle(
      {
        ...target,
        target_angle: target.target
      },
      value,
      profile.tolerance_scale
    );
    evidence.push({
      ...target,
      ...result,
      group: target.group || "focus",
      kind: "quality",
      measured: true,
      value: Math.round(value),
      weight
    });
  });

  const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  const measured = evidence.filter((item) => item.measured);
  const measuredWeight = measured.reduce((sum, item) => sum + item.weight, 0);
  const coverage = totalWeight ? Math.round((measuredWeight / totalWeight) * 100) : 0;
  const weightedScore = measuredWeight
    ? measured.reduce((sum, item) => sum + item.score * item.weight, 0) / measuredWeight
    : 0;
  const groupScores = Object.fromEntries(
    ["primary", "balance", "power", "alignment", "guard", "focus", "motion"].map((group) => {
      const groupItems = measured.filter((item) => item.group === group);
      const groupWeight = groupItems.reduce((sum, item) => sum + item.weight, 0);
      return [
        group,
        groupWeight
          ? Math.round(
              groupItems.reduce((sum, item) => sum + item.score * item.weight, 0) /
                groupWeight
            )
          : null
      ];
    })
  );
  const corrections = measured
    .filter((item) => item.issue && item.score < 80)
    .sort((first, second) => {
      return correctionUrgency(second, feedbackPriority) -
        correctionUrgency(first, feedbackPriority);
    })
    .map((item) => ({
      bodyPart: item.body_part || item.feature,
      label: item.label,
      kind: item.kind,
      current: item.value,
      ideal: item.ideal ?? item.value,
      min: item.min,
      max: item.max,
      direction: item.issue,
      group: item.group,
      score: Math.round(item.score),
      weight: item.weight
    }));
  const strengths = measured
    .filter(
      (item) =>
        ["angle", "quality"].includes(item.kind) &&
        !item.issue &&
        item.score >= 80
    )
    .sort(
      (first, second) =>
        (second.weight * second.score) - (first.weight * first.score)
    )
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.group === item.group) === index
    )
    .slice(0, Math.max(4, profile.correction_limit))
    .map((item) => ({
      bodyPart: item.body_part,
      label: item.label,
      current: item.value,
      ideal: item.ideal,
      score: Math.round(item.score),
      group: item.group,
      kind: item.kind
    }));

  return {
    accuracy: Math.round(weightedScore),
    coverage,
    corrections,
    strengths,
    difficulty,
    correctionLimit: profile.correction_limit,
    groupScores,
    scorable: coverage >= 35
  };
}

export const FORM_DIFFICULTIES = ["easy", "medium", "hard"];

export function buildCompositeCorrectionFeedback(correction) {
  if (!correction) return "";
  if (correction.kind === "quality") {
    const purpose = correction.group === "guard"
      ? "This keeps the hand safe and the strike structurally connected."
      : "This preserves visual focus and movement awareness.";
    return `${correction.label} is ${correction.current} percent; aim near ${correction.ideal} percent. ${purpose}`;
  }

  const bodyPart = correction.bodyPart || "";
  let action = correction.direction === "decrease" ? "Reduce the angle" : "Increase the angle";
  let purpose = "This improves whole-body alignment.";
  if (/knee/.test(bodyPart)) {
    action = correction.current > correction.ideal
      ? "Bend the knee slightly more"
      : "Straighten the knee slightly";
    purpose = "This stabilizes the front stance and supports force transfer.";
  } else if (/hip/.test(bodyPart)) {
    action = correction.current > correction.ideal
      ? "Close and settle the hip angle"
      : "Open the hip angle slightly";
    purpose = "This connects the stance to hip rotation and punching power.";
  } else if (/ankle/.test(bodyPart)) {
    action = "Adjust the foot and ankle base";
    purpose = "This improves balance and keeps pressure through the floor.";
  } else if (/shoulder/.test(bodyPart)) {
    action = "Adjust the shoulder angle";
    purpose = "This improves reach without losing posture.";
  } else if (/wrist/.test(bodyPart)) {
    action = "Straighten the wrist alignment";
    purpose = "This improves strike accuracy and protects the wrist.";
  } else if (/elbow/.test(bodyPart)) {
    action = correction.current > correction.ideal
      ? "Soften the elbow angle"
      : "Extend the elbow slightly more";
    purpose = "This improves punch structure without forcing a lock.";
  }

  return `${action}: current ${correction.current} degrees, ideal ${correction.ideal} degrees. ${purpose}`;
}

export function buildNaturalAwarenessFeedback({
  correction,
  situation,
  strength
}) {
  const state = situation?.situation_state;
  if (state === "tracking_unclear") {
    return "Step back; show your full body.";
  }
  if (state === "warning") {
    return "Pause, breathe, then reset your stance.";
  }
  if (!correction) {
    return strength
      ? `Good ${strength.label.toLowerCase()}. Keep it.`
      : "";
  }

  const bodyPart = correction.bodyPart || "";
  const label = correction.label?.toLowerCase() || bodyPart.replace(/_/g, " ");
  const side = /right|rear/.test(label) ? "rear" : "lead";
  if (correction.kind === "quality") {
    if (/fist/.test(bodyPart)) return `Close your ${side} fist firmly.`;
    if (/eyes/.test(bodyPart)) return "Keep your eyes on target.";
    if (/face_forward/.test(bodyPart)) return "Turn your head toward target.";
    if (/face_calm/.test(bodyPart)) return "Relax your face and jaw.";
    return `Correct your ${label}.`;
  }
  if (/knee/.test(bodyPart)) {
    return correction.current > correction.ideal
      ? `Bend your ${side} knee slightly more.`
      : `Straighten your ${side} knee slightly.`;
  }
  if (/hip/.test(bodyPart)) {
    return correction.current > correction.ideal
      ? `Settle your ${side} hip slightly.`
      : `Open your ${side} hip slightly.`;
  }
  if (/ankle/.test(bodyPart)) return `Set your ${side} foot firmly.`;
  if (/shoulder/.test(bodyPart)) return `Relax and align your ${side} shoulder.`;
  if (/wrist/.test(bodyPart)) return `Straighten your ${side} wrist.`;
  if (/elbow/.test(bodyPart)) {
    return correction.current > correction.ideal
      ? `Soften your ${side} elbow slightly.`
      : `Extend your ${side} elbow slightly more.`;
  }
  return `Adjust your ${label}.`;
}

function shortCorrectionName(correction) {
  const bodyPart = correction?.bodyPart || "position";
  const side = bodyPart.endsWith("_left") ? "lead" : bodyPart.endsWith("_right") ? "rear" : "";
  const joint = bodyPart.replace(/_(left|right)$/, "").replace(/_/g, " ");
  return `${side} ${joint}`.trim();
}

export function buildCorrectionAcknowledgement(previous, next) {
  const corrected = shortCorrectionName(previous);
  if (!next) return `Good ${corrected}. Hold it.`;
  return `Good ${corrected}. Now ${shortCorrectionName(next)}.`;
}
