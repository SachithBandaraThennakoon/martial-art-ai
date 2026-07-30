const ANGLE_MAP = {
  elbow_left: [11, 13, 15],
  elbow_right: [12, 14, 16],
  shoulder_left: [13, 11, 23],
  shoulder_right: [14, 12, 24],
  hip_left: [11, 23, 25],
  hip_right: [12, 24, 26],
  knee_left: [23, 25, 27],
  knee_right: [24, 26, 28],
  ankle_left: [25, 27, 31],
  ankle_right: [26, 28, 32],
  wrist_left: [13, 15, 19],
  wrist_right: [14, 16, 20]
};

const DEFAULT_CONFIG = {
  minimumFutureFrames: 6,
  minimumPredictionConfidence: 0.68,
  minimumTrackingConfidence: 0.55,
  maximumAgreementError: 0.08,
  minimumViolationFrames: 4,
  minimumRisk: 0.62
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function calculateAngle(a, b, c) {
  if (!a || !b || !c) return null;

  const ab = {
    x: a.x - b.x,
    y: a.y - b.y,
    z: (a.z || 0) - (b.z || 0)
  };
  const cb = {
    x: c.x - b.x,
    y: c.y - b.y,
    z: (c.z || 0) - (b.z || 0)
  };
  const denominator =
    Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
  if (!denominator) return null;

  const cosine = clamp(
    (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / denominator,
    -1,
    1
  );
  return Math.acos(cosine) * (180 / Math.PI);
}

function getRange(target) {
  const min = Number.isFinite(target?.min) ? target.min : target?.min_angle;
  const max = Number.isFinite(target?.max) ? target.max : target?.max_angle;
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function longestRun(values) {
  let longest = 0;
  let current = 0;
  values.forEach((value) => {
    current = value ? current + 1 : 0;
    longest = Math.max(longest, current);
  });
  return longest;
}

function evaluateTarget(target, futureFrames, config) {
  const mapping = ANGLE_MAP[target.body_part];
  const range = getRange(target);
  if (!mapping || !range) return null;

  const samples = futureFrames
    .map((frame) => {
      const landmarks = frame?.landmarks || [];
      const angle = calculateAngle(
        landmarks[mapping[0]],
        landmarks[mapping[1]],
        landmarks[mapping[2]]
      );
      if (!Number.isFinite(angle)) return null;

      const issue =
        angle < range.min ? "too_closed" : angle > range.max ? "too_open" : null;
      const margin = issue === "too_closed"
        ? range.min - angle
        : issue === "too_open"
          ? angle - range.max
          : 0;
      return {
        angle,
        issue,
        margin,
        horizonMs: frame.horizon_ms ?? frame.horizonMs ?? null
      };
    })
    .filter(Boolean);
  if (!samples.length) return null;

  const violations = samples.map((sample) => Boolean(sample.issue));
  const violationCount = violations.filter(Boolean).length;
  const sustainedFrames = longestRun(violations);
  const violatingSamples = samples.filter((sample) => sample.issue);
  const firstViolation = violatingSamples[0];
  const dominantIssue = violatingSamples.filter(
    (sample) => sample.issue === "too_open"
  ).length >= violationCount / 2
    ? "too_open"
    : "too_closed";
  const maximumMargin = violatingSamples.reduce(
    (maximum, sample) => Math.max(maximum, sample.margin),
    0
  );
  const tolerance = Math.max((range.max - range.min) / 2, 8);
  const risk = clamp(
    (violationCount / samples.length) * 0.45 +
      (sustainedFrames / samples.length) * 0.35 +
      clamp(maximumMargin / (tolerance * 2), 0, 1) * 0.2,
    0,
    1
  );

  return {
    body_part: target.body_part,
    issue: dominantIssue,
    risk: round(risk),
    first_risk_ms: firstViolation?.horizonMs ?? null,
    sustained_frames: sustainedFrames,
    violating_frames: violationCount,
    evaluated_frames: samples.length,
    predicted_angle_deg: round(
      violatingSamples[violatingSamples.length - 1]?.angle ??
        samples[samples.length - 1]?.angle,
      1
    ),
    target_min: range.min,
    target_max: range.max,
    confirmed:
      violationCount >= config.minimumViolationFrames &&
      sustainedFrames >= config.minimumViolationFrames &&
      risk >= config.minimumRisk
  };
}

export function deriveForecastAwareness({
  prediction,
  requiredParts = [],
  trackingConfidence = 0,
  predictionConfidence = 0,
  agreementError = null,
  sourceCounts = null,
  config: overrides = {}
} = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const futureFrames = prediction?.future_landmark_frames || [];
  const modelReady =
    prediction?.source === "onnx" &&
    String(prediction?.status || "").startsWith("ready");
  const hasMaturedValidation =
    (sourceCounts?.level2 || 0) > 0 && Number.isFinite(agreementError);
  const confidenceReady =
    trackingConfidence >= config.minimumTrackingConfidence &&
    predictionConfidence >= config.minimumPredictionConfidence;
  const agreementReady =
    hasMaturedValidation && agreementError <= config.maximumAgreementError;
  const framesReady = futureFrames.length >= config.minimumFutureFrames;
  const trusted = modelReady && confidenceReady && agreementReady && framesReady;

  const risks = requiredParts
    .map((target) => evaluateTarget(target, futureFrames, config))
    .filter(Boolean)
    .sort((first, second) => second.risk - first.risk);
  const likelyMistake = risks.find((risk) => risk.confirmed) || null;
  const horizonMs =
    prediction?.prediction_horizon_ms ??
    futureFrames[futureFrames.length - 1]?.horizon_ms ??
    null;

  let status = "warming";
  let reason = "waiting_for_validated_forecast";
  if (!modelReady) {
    status = prediction?.status || "waiting";
    reason = "model_not_ready";
  } else if (!framesReady) {
    reason = "insufficient_future_frames";
  } else if (!confidenceReady) {
    status = "untrusted";
    reason = "low_confidence";
  } else if (!hasMaturedValidation) {
    reason = "waiting_for_prediction_agreement";
  } else if (!agreementReady) {
    status = "untrusted";
    reason = "prediction_disagrees_with_live_pose";
  } else {
    status = "trusted";
    reason = likelyMistake ? "future_form_risk_confirmed" : "future_path_clear";
  }

  return {
    status,
    reason,
    trusted,
    model_status: prediction?.status || "not_ready",
    horizon_ms: horizonMs,
    future_frames: futureFrames.length,
    prediction_confidence: round(predictionConfidence),
    tracking_confidence: round(trackingConfidence),
    agreement_error: round(agreementError, 5),
    validation_samples: sourceCounts?.level2 || 0,
    risk: trusted ? likelyMistake?.risk || 0 : 0,
    likely_mistake: trusted ? likelyMistake : null,
    target_forecasts: risks
  };
}
