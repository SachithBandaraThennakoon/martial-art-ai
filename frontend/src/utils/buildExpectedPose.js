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
  if (Number.isFinite(Number(target.target_angle))) {
    return clamp(Number(target.target_angle), 0, 180);
  }
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

function buildJabPose(stepName = "", targets = new Map()) {
  const isExtension = /extend/i.test(stepName);
  const leadElbow = midpoint(targets.get("elbow_left"), isExtension ? 151 : 78);
  const rearElbow = midpoint(targets.get("elbow_right"), 78);
  const leadKnee = midpoint(targets.get("knee_left"), isExtension ? 125 : 162);
  const rearKnee = midpoint(targets.get("knee_right"), isExtension ? 165 : 162);
  const extension = clamp((leadElbow - 55) / 115, 0, 1);
  const leadKneeBend = clamp((180 - leadKnee) / 75, 0, 1);
  const rearKneeBend = clamp((180 - rearKnee) / 75, 0, 1);
  const points = {
    head: { x: 49, y: 10 },
    shoulder_left: { x: 42, y: 24 },
    shoulder_right: { x: 57, y: 27 },
    hip_left: { x: 44, y: 58 },
    hip_right: { x: 56, y: 60 },
    knee_left: { x: 42 - leadKneeBend * 18, y: 82 },
    knee_right: { x: 60 + rearKneeBend * 18, y: 84 },
    ankle_left: { x: 31 - leadKneeBend * 14, y: 108 },
    ankle_right: { x: 78 + (1 - rearKneeBend) * 8, y: 108 },
    elbow_right: { x: 68, y: 45 },
    wrist_right: { x: 57, y: 58 }
  };

  if (isExtension) {
    // Karate lunge-punch silhouette: lead arm drives level, rear fist chambers
    // at the hip, front knee bends over the lead foot, and rear leg stays long.
    points.elbow_left = { x: 40 - extension * 16, y: 27 + (1 - extension) * 8 };
    points.wrist_left = { x: 31 - extension * 24, y: 27 + (1 - extension) * 10 };
    points.elbow_right = { x: 63 + (180 - rearElbow) * 0.06, y: 45 };
    points.wrist_right = { x: 57, y: 58 };
  } else {
    points.elbow_left = { x: 28, y: 42 };
    points.wrist_left = { x: 41, y: 29 };
    points.elbow_right = { x: 68, y: 45 };
    points.wrist_right = { x: 57, y: 58 };
  }

  return points;
}

export function buildExpectedPose(requiredParts = [], stepName = "") {
  const targets = new Map(requiredParts.map((target) => [target.body_part, target]));

  if (/guard stance|extend lead hand|return to guard/i.test(stepName)) {
    return buildJabPose(stepName, targets);
  }

  const points = {
    head: { x: 50, y: 10 },
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

export function projectExpectedPose(pose, viewDegrees = 30, mirrored = false) {
  const turn = Math.min(90, Math.max(0, viewDegrees)) / 90;
  const widthScale = 1 - turn * 0.18;

  return Object.fromEntries(
    Object.entries(pose).map(([name, point]) => {
      const isLeft = name.endsWith("_left");
      const isRight = name.endsWith("_right");
      const depthDirection = isLeft ? -1 : isRight ? 1 : 0;
      const isTorsoJoint = /shoulder|hip/.test(name);
      const convergence = isTorsoJoint ? depthDirection * -3.5 * turn : 0;
      const depthDrop = depthDirection * 3 * turn;
      const projectedX = 50 + (point.x - 50) * widthScale + convergence;

      return [
        name,
        {
          // Authored poses use mirror-view coordinates. Keep that direction
          // beside mirrored video and reverse it for non-mirrored video.
          x: mirrored ? projectedX : 100 - projectedX,
          y: point.y + depthDrop
        }
      ];
    })
  );
}

