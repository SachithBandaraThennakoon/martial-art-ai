const DEFAULT_ANGLES = {
  shoulder: 22,
  elbow: 168,
  hip: 168,
  knee: 168
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function midpoint(target, fallback) {
  if (!target) return fallback;
  return clamp((Number(target.min) + Number(target.max)) / 2, 0, 180);
}

function pointFrom(origin, angleDegrees, length) {
  const radians = angleDegrees * (Math.PI / 180);
  return {
    x: origin.x + Math.cos(radians) * length,
    y: origin.y + Math.sin(radians) * length
  };
}

function inferShoulderAngle(stepName = "") {
  if (/overhead|reach/i.test(stepName)) return 155;
  if (/extend|punch|strike|block|frame|post/i.test(stepName)) return 88;
  if (/guard|cover|uppercut|chamber|ready|protect/i.test(stepName)) return 52;
  return DEFAULT_ANGLES.shoulder;
}

function inferElbowAngle(stepName = "") {
  if (/extend|punch|strike|reach|plank|press|stand tall/i.test(stepName)) return 165;
  if (/guard|cover|uppercut|chamber|ready|protect/i.test(stepName)) return 78;
  return DEFAULT_ANGLES.elbow;
}

function buildArm({ side, shoulder, hip, targets, stepName }) {
  const direction = side === "left" ? 1 : -1;
  const shoulderAngle = midpoint(
    targets.get(`shoulder_${side}`),
    inferShoulderAngle(stepName)
  );
  const elbowAngle = midpoint(
    targets.get(`elbow_${side}`),
    inferElbowAngle(stepName)
  );
  const torsoAngle = Math.atan2(hip.y - shoulder.y, hip.x - shoulder.x) * (180 / Math.PI);
  const upperArmAngle = torsoAngle + direction * shoulderAngle;
  const elbow = pointFrom(shoulder, upperArmAngle, 17);
  const forearmAngle = upperArmAngle + direction * (180 - elbowAngle);
  const wrist = pointFrom(elbow, forearmAngle, 16);

  return { elbow, wrist };
}

function buildLeg({ side, shoulder, hip, targets }) {
  const direction = side === "left" ? 1 : -1;
  const hipAngle = midpoint(targets.get(`hip_${side}`), DEFAULT_ANGLES.hip);
  const kneeAngle = midpoint(targets.get(`knee_${side}`), DEFAULT_ANGLES.knee);
  const torsoUpAngle = Math.atan2(shoulder.y - hip.y, shoulder.x - hip.x) * (180 / Math.PI);
  const thighAngle = torsoUpAngle - direction * hipAngle;
  const knee = pointFrom(hip, thighAngle, 25);
  const bendDirection = hipAngle < 125 ? -direction : direction;
  const shinAngle = thighAngle + bendDirection * (180 - kneeAngle) * 0.92;
  const ankle = pointFrom(knee, shinAngle, 24);

  return { knee, ankle };
}

export function buildExpectedPose(requiredParts = [], stepName = "") {
  const targets = new Map(requiredParts.map((target) => [target.body_part, target]));
  const points = {
    shoulder_left: { x: 43, y: 25 },
    shoulder_right: { x: 57, y: 25 },
    hip_left: { x: 46, y: 60 },
    hip_right: { x: 54, y: 60 }
  };

  const leftArm = buildArm({
    side: "left",
    shoulder: points.shoulder_left,
    hip: points.hip_left,
    targets,
    stepName
  });
  const rightArm = buildArm({
    side: "right",
    shoulder: points.shoulder_right,
    hip: points.hip_right,
    targets,
    stepName
  });
  const leftLeg = buildLeg({
    side: "left",
    shoulder: points.shoulder_left,
    hip: points.hip_left,
    targets
  });
  const rightLeg = buildLeg({
    side: "right",
    shoulder: points.shoulder_right,
    hip: points.hip_right,
    targets
  });

  return {
    ...points,
    elbow_left: leftArm.elbow,
    wrist_left: leftArm.wrist,
    elbow_right: rightArm.elbow,
    wrist_right: rightArm.wrist,
    knee_left: leftLeg.knee,
    ankle_left: leftLeg.ankle,
    knee_right: rightLeg.knee,
    ankle_right: rightLeg.ankle
  };
}

