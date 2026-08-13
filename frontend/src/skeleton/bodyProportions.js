const BASE_POSE = {
  head: [0, 1.65, 0],
  shoulder_left: [-0.52, 1.15, 0],
  shoulder_right: [0.52, 1.15, 0],
  elbow_left: [-0.84, 0.67, 0.02],
  elbow_right: [0.84, 0.67, 0.02],
  wrist_left: [-0.62, 0.18, 0.05],
  wrist_right: [0.62, 0.18, 0.05],
  hip_left: [-0.38, 0.1, 0],
  hip_right: [0.38, 0.1, 0],
  knee_left: [-0.43, -0.78, 0.04],
  knee_right: [0.43, -0.78, 0.04],
  ankle_left: [-0.39, -1.6, 0],
  ankle_right: [0.39, -1.6, 0],
  foot_left: [-0.42, -1.72, 0.35],
  foot_right: [0.42, -1.72, 0.35],
};

// Segment lengths as a fraction of shoulder-center to hip-center distance.
// Paired values are intentionally symmetrical to keep authored poses neutral.
export const BODY_BONE_RATIOS = Object.freeze({
  headOffset: 0.48,
  shoulderWidth: 0.95,
  hipWidth: 0.68,
  upperArm: 0.55,
  forearm: 0.52,
  thigh: 0.86,
  shin: 0.8,
  foot: 0.31,
});

function midpoint(first, second) {
  return first.map((value, axis) => (value + second[axis]) / 2);
}

function direction(from, to) {
  const delta = to.map((value, axis) => value - from[axis]);
  const length = Math.hypot(...delta) || 1;
  return delta.map((value) => value / length);
}

function extend(from, toward, length) {
  const unit = direction(from, toward);
  return from.map((value, axis) => value + unit[axis] * length);
}

function centeredPair(center, axis, width) {
  return [
    center.map((value, index) => value - axis[index] * width / 2),
    center.map((value, index) => value + axis[index] * width / 2),
  ];
}

export function createAnatomicalDefaultPose() {
  const shoulderCenter = midpoint(BASE_POSE.shoulder_left, BASE_POSE.shoulder_right);
  const hipCenter = midpoint(BASE_POSE.hip_left, BASE_POSE.hip_right);
  const torsoLength = Math.hypot(
    ...shoulderCenter.map((value, axis) => value - hipCenter[axis]),
  );
  const lateralAxis = direction(BASE_POSE.shoulder_left, BASE_POSE.shoulder_right);
  const [shoulderLeft, shoulderRight] = centeredPair(
    shoulderCenter,
    lateralAxis,
    torsoLength * BODY_BONE_RATIOS.shoulderWidth,
  );
  const [hipLeft, hipRight] = centeredPair(
    hipCenter,
    lateralAxis,
    torsoLength * BODY_BONE_RATIOS.hipWidth,
  );
  const pose = {
    head: extend(shoulderCenter, BASE_POSE.head, torsoLength * BODY_BONE_RATIOS.headOffset),
    shoulder_left: shoulderLeft,
    shoulder_right: shoulderRight,
    hip_left: hipLeft,
    hip_right: hipRight,
  };

  for (const side of ["left", "right"]) {
    pose[`elbow_${side}`] = extend(
      pose[`shoulder_${side}`],
      BASE_POSE[`elbow_${side}`],
      torsoLength * BODY_BONE_RATIOS.upperArm,
    );
    pose[`wrist_${side}`] = extend(
      pose[`elbow_${side}`],
      BASE_POSE[`wrist_${side}`],
      torsoLength * BODY_BONE_RATIOS.forearm,
    );
    pose[`knee_${side}`] = extend(
      pose[`hip_${side}`],
      BASE_POSE[`knee_${side}`],
      torsoLength * BODY_BONE_RATIOS.thigh,
    );
    pose[`ankle_${side}`] = extend(
      pose[`knee_${side}`],
      BASE_POSE[`ankle_${side}`],
      torsoLength * BODY_BONE_RATIOS.shin,
    );
    pose[`foot_${side}`] = extend(
      pose[`ankle_${side}`],
      BASE_POSE[`foot_${side}`],
      torsoLength * BODY_BONE_RATIOS.foot,
    );
  }
  return pose;
}
