function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function thresholdScore(satisfied, signedMargin, scale) {
  const normalizedMargin = clamp(Math.abs(signedMargin) / Math.max(Math.abs(scale), 0.001));
  return satisfied
    ? 0.75 + normalizedMargin * 0.25
    : Math.max(0, 0.75 - normalizedMargin * 0.75);
}

function evaluateLeaf(condition, features, context) {
  const actual = finite(features?.[condition.feature]);
  const previous = finite(context.previousFeatures?.[condition.feature]);
  const baseline = finite(context.baselineFeatures?.[condition.feature]);
  let satisfied = false;
  let score = 0;
  let margin = null;

  if (actual === null) {
    return {
      type: "condition",
      feature: condition.feature,
      operator: condition.operator,
      actual: null,
      satisfied: false,
      score: 0,
      margin: null,
      reason: "missing_feature"
    };
  }

  switch (condition.operator) {
    case "gte":
    case "gt": {
      const target = Number(condition.value);
      margin = actual - target;
      satisfied = condition.operator === "gte" ? actual >= target : actual > target;
      score = thresholdScore(satisfied, margin, target || 1);
      break;
    }
    case "lte":
    case "lt": {
      const target = Number(condition.value);
      margin = target - actual;
      satisfied = condition.operator === "lte" ? actual <= target : actual < target;
      score = thresholdScore(satisfied, margin, target || 1);
      break;
    }
    case "between": {
      const min = Number(condition.min);
      const max = Number(condition.max);
      const center = (min + max) / 2;
      const halfWidth = Math.max((max - min) / 2, 0.001);
      satisfied = actual >= min && actual <= max;
      margin = satisfied
        ? Math.min(actual - min, max - actual)
        : -Math.min(Math.abs(actual - min), Math.abs(actual - max));
      score = satisfied
        ? 0.75 + 0.25 * clamp(1 - Math.abs(actual - center) / halfWidth)
        : Math.max(0, 0.75 - 0.75 * Math.abs(margin) / halfWidth);
      break;
    }
    case "increasing":
    case "decreasing": {
      const minimumDelta = Number(condition.value ?? condition.margin ?? 0);
      if (previous === null) break;
      const delta = actual - previous;
      margin = condition.operator === "increasing"
        ? delta - minimumDelta
        : -delta - minimumDelta;
      satisfied = margin >= 0;
      score = thresholdScore(satisfied, margin, minimumDelta || 1);
      break;
    }
    case "stable": {
      const tolerance = Math.max(Number(condition.value ?? condition.margin ?? 0.02), 0.001);
      if (previous === null) break;
      const delta = Math.abs(actual - previous);
      margin = tolerance - delta;
      satisfied = delta <= tolerance;
      score = thresholdScore(satisfied, margin, tolerance);
      break;
    }
    case "near_baseline": {
      const tolerance = Math.max(Number(condition.value ?? condition.margin ?? 0.05), 0.001);
      if (baseline === null) break;
      const delta = Math.abs(actual - baseline);
      margin = tolerance - delta;
      satisfied = delta <= tolerance;
      score = thresholdScore(satisfied, margin, tolerance);
      break;
    }
    default:
      break;
  }

  return {
    type: "condition",
    feature: condition.feature,
    operator: condition.operator,
    actual,
    satisfied,
    score: Number(clamp(score).toFixed(3)),
    margin: Number.isFinite(margin) ? Number(margin.toFixed(4)) : null,
    reason: satisfied ? "satisfied" : "threshold_not_met"
  };
}

export function evaluateRule(rule, features = {}, context = {}) {
  if (Array.isArray(rule?.all)) {
    const evidence = rule.all.map((child) => evaluateRule(child, features, context));
    return {
      type: "all",
      satisfied: evidence.every((item) => item.satisfied),
      score: Number((
        evidence.reduce((total, item) => total + item.score, 0) /
        Math.max(evidence.length, 1)
      ).toFixed(3)),
      satisfiedCount: evidence.filter((item) => item.satisfied).length,
      ruleCount: evidence.length,
      evidence
    };
  }

  if (Array.isArray(rule?.any)) {
    const evidence = rule.any.map((child) => evaluateRule(child, features, context));
    return {
      type: "any",
      satisfied: evidence.some((item) => item.satisfied),
      score: Number(Math.max(0, ...evidence.map((item) => item.score)).toFixed(3)),
      satisfiedCount: evidence.filter((item) => item.satisfied).length,
      ruleCount: evidence.length,
      evidence
    };
  }

  return evaluateLeaf(rule || {}, features, context);
}

export function calculateRuleConfidence({
  evaluation,
  trackingConfidence = 1,
  temporalConsistency = 1,
  validPreviousState = 1,
  durationPlausibility = 1,
  signalAgreement = null
}) {
  const ruleScore = clamp(evaluation?.score || 0);
  const tracking = clamp(trackingConfidence);
  const temporal = clamp(temporalConsistency);
  const previous = clamp(validPreviousState);
  const duration = clamp(durationPlausibility);
  const agreement = clamp(
    signalAgreement ??
    ((evaluation?.satisfiedCount || 0) / Math.max(evaluation?.ruleCount || 1, 1))
  );
  const confidence = clamp(
    ruleScore * 0.35 +
    tracking * 0.2 +
    temporal * 0.15 +
    previous * 0.1 +
    duration * 0.1 +
    agreement * 0.1
  );

  return {
    confidence: Number(confidence.toFixed(3)),
    components: {
      rule_strength: Number(ruleScore.toFixed(3)),
      tracking_quality: Number(tracking.toFixed(3)),
      temporal_consistency: Number(temporal.toFixed(3)),
      valid_previous_state: Number(previous.toFixed(3)),
      duration_plausibility: Number(duration.toFixed(3)),
      signal_agreement: Number(agreement.toFixed(3))
    }
  };
}
