const REQUIRED_POINTS = [11, 12, 13, 14, 15, 16, 23, 24];
const MIN_VISIBILITY = 0.55;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const distance = (first, second) =>
  Math.hypot(
    first.x - second.x,
    first.y - second.y,
    (first.z || 0) - (second.z || 0)
  );

const median = (values) => {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const isVisible = (point) =>
  point && (point.visibility == null || point.visibility >= MIN_VISIBILITY);

export function getBodyCalibrationSample(landmarks = []) {
  const points = REQUIRED_POINTS.map((index) => landmarks[index]);
  if (!points.every(isVisible)) {
    return { accepted: false, guidance: "Keep both shoulders, elbows, wrists, and hips in view." };
  }

  if (points.some((point) => point.x < 0.04 || point.x > 0.96 || point.y < 0.04 || point.y > 0.96)) {
    return { accepted: false, guidance: "Step back a little so your upper body has space around it." };
  }

  const shoulderWidth = distance(landmarks[11], landmarks[12]);
  const torsoLength = (distance(landmarks[11], landmarks[23]) + distance(landmarks[12], landmarks[24])) / 2;
  const leftUpperArm = distance(landmarks[11], landmarks[13]);
  const rightUpperArm = distance(landmarks[12], landmarks[14]);
  const leftForearm = distance(landmarks[13], landmarks[15]);
  const rightForearm = distance(landmarks[14], landmarks[16]);

  if (shoulderWidth < 0.1 || torsoLength < 0.08) {
    return { accepted: false, guidance: "Move back until your shoulders and hips are clearly visible." };
  }

  const shoulderTilt = Math.abs(landmarks[11].y - landmarks[12].y) / shoulderWidth;
  const hipTilt = Math.abs(landmarks[23].y - landmarks[24].y) / shoulderWidth;
  if (shoulderTilt > 0.3 || hipTilt > 0.34) {
    return { accepted: false, guidance: "Stand naturally facing the camera, with your shoulders level." };
  }

  return {
    accepted: true,
    guidance: "Hold still and face the camera. Collecting your personal proportions…",
    ratios: {
      shoulder_to_torso: shoulderWidth / torsoLength,
      left_upper_to_forearm: leftUpperArm / Math.max(leftForearm, 0.001),
      right_upper_to_forearm: rightUpperArm / Math.max(rightForearm, 0.001),
      left_arm_to_torso: (leftUpperArm + leftForearm) / torsoLength,
      right_arm_to_torso: (rightUpperArm + rightForearm) / torsoLength,
      upper_arm_symmetry: leftUpperArm / Math.max(rightUpperArm, 0.001),
      forearm_symmetry: leftForearm / Math.max(rightForearm, 0.001)
    }
  };
}

export function buildBodyCalibrationProfile(samples = []) {
  if (!samples.length) return null;

  const ratioKeys = Object.keys(samples[0]);
  const ratios = Object.fromEntries(
    ratioKeys.map((key) => [key, Number(median(samples.map((sample) => sample[key])).toFixed(5))])
  );
  const relativeSpread = ratioKeys.flatMap((key) => {
    const center = Math.max(ratios[key], 0.001);
    return samples.map((sample) => Math.abs(sample[key] - center) / center);
  });
  const averageSpread = relativeSpread.reduce((total, value) => total + value, 0) /
    Math.max(relativeSpread.length, 1);

  return {
    ratios,
    sample_count: samples.length,
    stability_score: Math.round(clamp(100 - averageSpread * 320, 0, 100)),
    updated_at: new Date().toISOString()
  };
}

export function getCalibrationFit(landmarks, calibration) {
  if (!calibration?.ratios) return { score: 100, guidance: null };
  const sample = getBodyCalibrationSample(landmarks);
  if (!sample.accepted) return { score: 0, guidance: sample.guidance };

  const differences = Object.entries(calibration.ratios)
    .filter(([key]) => Number.isFinite(sample.ratios[key]))
    .map(([key, value]) => Math.abs(sample.ratios[key] - value) / Math.max(value, 0.001));
  const drift = differences.reduce((total, value) => total + value, 0) / Math.max(differences.length, 1);
  const score = Math.round(clamp(100 - drift * 230, 0, 100));

  return {
    score,
    guidance: score >= 62 ? null : "Camera position changed. Face forward and keep shoulders and hips fully visible."
  };
}
