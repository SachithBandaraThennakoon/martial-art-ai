const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function pointMap(compactLandmarks = []) {
  return new Map(compactLandmarks.map((point) => [Number(point.index), point]));
}

function distance(first, second) {
  if (!first || !second) return null;
  return Math.hypot(
    (first.x || 0) - (second.x || 0),
    (first.y || 0) - (second.y || 0),
    (first.z || 0) - (second.z || 0)
  );
}

function midpoint(first, second) {
  if (!first || !second) return null;
  return {
    x: ((first.x || 0) + (second.x || 0)) / 2,
    y: ((first.y || 0) + (second.y || 0)) / 2,
    z: ((first.z || 0) + (second.z || 0)) / 2
  };
}

function vectorMagnitude(vector) {
  return Math.hypot(vector?.x || 0, vector?.y || 0, vector?.z || 0);
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function angularVelocity(current, previous, deltaSeconds) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || deltaSeconds <= 0) return 0;
  return (current - previous) / deltaSeconds;
}

function radialVelocity(currentDistance, previousDistance, deltaSeconds) {
  if (
    !Number.isFinite(currentDistance) ||
    !Number.isFinite(previousDistance) ||
    deltaSeconds <= 0
  ) {
    return 0;
  }
  return (currentDistance - previousDistance) / deltaSeconds;
}

function torsoLeanDegrees(shoulderCenter, hipCenter) {
  if (!shoulderCenter || !hipCenter) return null;
  const horizontal = Math.hypot(
    shoulderCenter.x - hipCenter.x,
    (shoulderCenter.z || 0) - (hipCenter.z || 0)
  );
  const vertical = Math.abs(shoulderCenter.y - hipCenter.y);
  return Math.atan2(horizontal, Math.max(vertical, 0.001)) * (180 / Math.PI);
}

function torsoRotationDegrees(leftShoulder, rightShoulder, leftHip, rightHip) {
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  const shoulderAngle = Math.atan2(
    rightShoulder.y - leftShoulder.y,
    rightShoulder.x - leftShoulder.x
  );
  const hipAngle = Math.atan2(
    rightHip.y - leftHip.y,
    rightHip.x - leftHip.x
  );
  const difference = Math.abs(shoulderAngle - hipAngle);
  const wrappedDifference = Math.min(difference, Math.PI * 2 - difference);
  return wrappedDifference * (180 / Math.PI);
}

export class BiomechanicalFeatureExtractor {
  constructor({ stanceBaselineAlpha = 0.05, stableMotionThreshold = 0.04 } = {}) {
    this.config = { stanceBaselineAlpha, stableMotionThreshold };
    this.reset();
  }

  reset() {
    this.previousTimestampMs = null;
    this.previous = null;
    this.stanceBaseline = { left: null, right: null };
  }

  update(level1State, { leadSide = "left", kickSide = "right" } = {}) {
    if (!level1State?.motion_context) return null;
    const timestampMs = Number(level1State.timestamp) * 1000;
    if (!Number.isFinite(timestampMs)) return null;

    const landmarks = pointMap(level1State.motion_context.normalized_landmarks);
    const angles = level1State.motion_context.angles_deg || {};
    const auxiliary = {
      ...angles,
      ...(level1State.motion_context.auxiliary_features || {})
    };
    const velocities = level1State.motion_context.velocity || {};
    const deltaSeconds = this.previousTimestampMs === null
      ? 0
      : Math.max((timestampMs - this.previousTimestampMs) / 1000, 0.001);
    const lead = leadSide === "right" ? "right" : "left";
    const rear = lead === "left" ? "right" : "left";
    const kick = kickSide === "left" ? "left" : "right";
    const support = kick === "left" ? "right" : "left";

    const get = (name) => landmarks.get(LANDMARK[name]);
    const leftShoulder = get("leftShoulder");
    const rightShoulder = get("rightShoulder");
    const leftHip = get("leftHip");
    const rightHip = get("rightHip");
    const leadShoulder = get(`${lead}Shoulder`);
    const leadWrist = get(`${lead}Wrist`);
    const rearShoulder = get(`${rear}Shoulder`);
    const rearWrist = get(`${rear}Wrist`);
    const kickHip = get(`${kick}Hip`);
    const kickKnee = get(`${kick}Knee`);
    const kickAnkle = get(`${kick}Ankle`);
    const shoulderCenter = midpoint(leftShoulder, rightShoulder);
    const hipCenter = midpoint(leftHip, rightHip);
    const leadReach = distance(leadWrist, leadShoulder);
    const kickReach = distance(kickAnkle, kickHip);
    const motionEnergy = average(
      Object.values(velocities).map(vectorMagnitude)
    );
    const supportStability = clamp(
      1 - average([
        vectorMagnitude(velocities[LANDMARK[`${support}Knee`]]),
        vectorMagnitude(velocities[LANDMARK[`${support}Ankle`]])
      ]) / 0.5
    );

    const baseline = this.stanceBaseline[kick];
    const returnToStanceDistance = baseline && kickAnkle
      ? distance(kickAnkle, baseline)
      : 0;
    if (kickAnkle && (!baseline || motionEnergy <= this.config.stableMotionThreshold)) {
      const alpha = baseline ? this.config.stanceBaselineAlpha : 1;
      this.stanceBaseline[kick] = {
        x: (baseline?.x || 0) * (1 - alpha) + kickAnkle.x * alpha,
        y: (baseline?.y || 0) * (1 - alpha) + kickAnkle.y * alpha,
        z: (baseline?.z || 0) * (1 - alpha) + (kickAnkle.z || 0) * alpha
      };
    }

    const leadElbowAngle = angles[`elbow_${lead}`];
    const kickKneeAngle = angles[`knee_${kick}`];
    const features = {
      lead_elbow_angle: leadElbowAngle,
      lead_elbow_angular_velocity: angularVelocity(
        leadElbowAngle,
        this.previous?.leadElbowAngle,
        deltaSeconds
      ),
      lead_wrist_guard_distance: distance(leadWrist, leadShoulder),
      lead_wrist_forward_velocity: radialVelocity(
        leadReach,
        this.previous?.leadReach,
        deltaSeconds
      ),
      rear_wrist_guard_distance: distance(rearWrist, rearShoulder),
      lead_fist_closure_score: auxiliary[`fist_${lead}`],
      rear_fist_closure_score: auxiliary[`fist_${rear}`],
      face_forward_score: auxiliary.face_forward,
      eyes_forward_score: auxiliary.eyes_forward,
      face_calm_score: auxiliary.face_calm,
      torso_lean: torsoLeanDegrees(shoulderCenter, hipCenter),
      torso_rotation: torsoRotationDegrees(
        leftShoulder,
        rightShoulder,
        leftHip,
        rightHip
      ),
      motion_energy: motionEnergy,
      kick_hip_angle: angles[`hip_${kick}`],
      kick_knee_angle: kickKneeAngle,
      kick_knee_height:
        kickHip && kickKnee ? Math.max(0, kickHip.y - kickKnee.y) : null,
      kick_foot_forward_velocity: radialVelocity(
        kickReach,
        this.previous?.kickReach,
        deltaSeconds
      ),
      kick_knee_angular_velocity: angularVelocity(
        kickKneeAngle,
        this.previous?.kickKneeAngle,
        deltaSeconds
      ),
      support_leg_stability: supportStability,
      return_to_stance_distance: returnToStanceDistance
    };

    this.previousTimestampMs = timestampMs;
    this.previous = {
      leadElbowAngle,
      leadReach,
      kickKneeAngle,
      kickReach,
      features
    };

    return {
      timestampMs,
      features: Object.fromEntries(
        Object.entries(features).map(([key, value]) => [
          key,
          Number.isFinite(value) ? Number(value.toFixed(4)) : null
        ])
      ),
      trackingConfidence: Number(level1State.tracking?.confidence) || 0,
      sides: { lead, rear, kick, support }
    };
  }
}
