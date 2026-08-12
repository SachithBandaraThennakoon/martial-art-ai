const LANDMARK_INDEX = {
  head: 0,
  shoulder_left: 11,
  shoulder_right: 12,
  elbow_left: 13,
  elbow_right: 14,
  wrist_left: 15,
  wrist_right: 16,
  hip_left: 23,
  hip_right: 24,
  knee_left: 25,
  knee_right: 26,
  ankle_left: 27,
  ankle_right: 28,
  foot_left: 31,
  foot_right: 32
};

const MIN_VISIBILITY = 0.55;
const MIN_DEPTH_VISIBILITY = 0.7;
const DEFAULT_DEPTH_TOLERANCE_SCALE = 1.75;

const averagePoint = (first, second) => ({
  x: (Number(first.x) + Number(second.x)) / 2,
  y: (Number(first.y) + Number(second.y)) / 2,
  z: (Number(first.z || 0) + Number(second.z || 0)) / 2
});

function usable(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    (point.visibility == null || point.visibility >= MIN_VISIBILITY);
}

function normalizedCandidates(pose) {
  const leftHip = pose?.[23];
  const rightHip = pose?.[24];
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  if (![leftHip, rightHip, leftShoulder, rightShoulder].every(usable)) return null;

  const hipCenter = averagePoint(leftHip, rightHip);
  const shoulderCenter = averagePoint(leftShoulder, rightShoulder);
  const torsoLength = Math.hypot(
    shoulderCenter.x - hipCenter.x,
    shoulderCenter.y - hipCenter.y,
    shoulderCenter.z - hipCenter.z
  );
  if (!Number.isFinite(torsoLength) || torsoLength < 0.02) return null;

  const build = (xSign) => Object.fromEntries(
    Object.entries(LANDMARK_INDEX).flatMap(([name, index]) => {
      const point = pose[index];
      if (!usable(point)) return [];
      const normalizedX = xSign * (point.x - hipCenter.x) / torsoLength;
      const normalizedY = -(point.y - hipCenter.y) / torsoLength;
      // MediaPipe world Z becomes more negative toward the camera. Invert it
      // so positive normalized Z consistently means forward from the torso.
      const normalizedZ = -(Number(point.z || 0) - hipCenter.z) / torsoLength;
      return [[name, {
        x: Object.is(normalizedX, -0) ? 0 : normalizedX,
        y: Object.is(normalizedY, -0) ? 0 : normalizedY,
        z: Object.is(normalizedZ, -0) ? 0 : normalizedZ,
        visibility: point.visibility ?? 1
      }]];
    })
  );
  return [build(1), build(-1)];
}

function alignmentError(candidate, reference) {
  return ["shoulder_left", "shoulder_right", "hip_left", "hip_right"]
    .reduce((sum, name) => {
      const live = candidate[name];
      const target = reference[name];
      if (!live || !Array.isArray(target)) return sum;
      return sum + Math.abs(live.x - Number(target[0]));
    }, 0);
}

export function normalizeLivePoseForReference(pose, referenceLandmarks = {}) {
  const candidates = normalizedCandidates(pose);
  if (!candidates) return null;
  return alignmentError(candidates[0], referenceLandmarks) <=
    alignmentError(candidates[1], referenceLandmarks)
    ? candidates[0]
    : candidates[1];
}

function positionDirection(bodyPart, axis, delta) {
  if (axis === "y") return delta > 0 ? "raise" : "lower";
  if (axis === "z") return delta > 0 ? "forward" : "backward";
  const isLeft = bodyPart.endsWith("_left");
  const towardOutside = isLeft ? delta < 0 : delta > 0;
  return towardOutside ? "outward" : "inward";
}

export function evaluatePositionFeedback({
  livePose,
  referencePose,
  positionTargets,
  toleranceScale = 1
}) {
  const reference = referencePose?.landmarks;
  if (!reference || referencePose.coordinate_space !== "body_normalized_v1") return [];
  const normalized = normalizeLivePoseForReference(livePose, reference);
  if (!normalized) return [];

  const configured = Array.isArray(positionTargets) && positionTargets.length
    ? positionTargets
    : Object.keys(reference).map((body_part) => ({ body_part }));

  return configured.flatMap((target) => {
    const bodyPart = target.body_part;
    const live = normalized[bodyPart];
    const expected = reference[bodyPart];
    if (!live || !Array.isArray(expected)) return [];
    const configuredTolerance = target.tolerance ?? referencePose.tolerance ?? 0.12;
    const toleranceFor = (axis) => {
      const axisValue = typeof configuredTolerance === "object"
        ? configuredTolerance?.[axis]
        : configuredTolerance;
      const base = Math.max(0.01, Number(axisValue) || 0.12);
      return base * toleranceScale * (axis === "z" ? DEFAULT_DEPTH_TOLERANCE_SCALE : 1);
    };
    const axes = Array.isArray(target.axes)
      ? target.axes.filter((axis) => ["x", "y", "z"].includes(axis))
      : ["x", "y", "z"];
    const differences = axes.map((axis) => ({
      axis,
      delta: Number(expected[{ x: 0, y: 1, z: 2 }[axis]]) - live[axis],
      tolerance: toleranceFor(axis)
    })).filter((item) =>
      Number.isFinite(item.delta) &&
      (item.axis !== "z" || live.visibility >= MIN_DEPTH_VISIBILITY)
    );
    const dominant = differences
      .filter((item) => Math.abs(item.delta) > item.tolerance)
      .sort((a, b) =>
        (Math.abs(b.delta) / b.tolerance) - (Math.abs(a.delta) / a.tolerance)
      )[0];
    if (!dominant) return [];
    const severity = Math.abs(dominant.delta) / dominant.tolerance;
    return [{
      bodyPart,
      label: target.label || bodyPart.replace(/_/g, " "),
      kind: "position",
      group: "position",
      direction: positionDirection(bodyPart, dominant.axis, dominant.delta),
      axis: dominant.axis,
      deviation: dominant.delta,
      score: Math.max(0, Math.round(80 - (severity - 1) * 40)),
      weight: Number(target.weight) || 0.5,
      visibility: live.visibility
    }];
  }).sort((first, second) => first.score - second.score);
}
