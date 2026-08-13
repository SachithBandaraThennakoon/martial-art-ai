import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_BONE_RATIOS,
  createAnatomicalDefaultPose,
} from "../src/skeleton/bodyProportions.js";

function midpoint(first, second) {
  return first.map((value, axis) => (value + second[axis]) / 2);
}

function length(first, second) {
  return Math.hypot(...first.map((value, axis) => value - second[axis]));
}

test("default authoring skeleton uses consistent bilateral bone ratios", () => {
  const pose = createAnatomicalDefaultPose();
  const shoulderCenter = midpoint(pose.shoulder_left, pose.shoulder_right);
  const hipCenter = midpoint(pose.hip_left, pose.hip_right);
  const torso = length(shoulderCenter, hipCenter);
  const expected = {
    shoulderWidth: length(pose.shoulder_left, pose.shoulder_right),
    hipWidth: length(pose.hip_left, pose.hip_right),
    headOffset: length(shoulderCenter, pose.head),
    upperArm: length(pose.shoulder_left, pose.elbow_left),
    forearm: length(pose.elbow_left, pose.wrist_left),
    thigh: length(pose.hip_left, pose.knee_left),
    shin: length(pose.knee_left, pose.ankle_left),
    foot: length(pose.ankle_left, pose.foot_left),
  };

  for (const [segment, actual] of Object.entries(expected)) {
    assert.ok(
      Math.abs(actual / torso - BODY_BONE_RATIOS[segment]) < 1e-10,
      `${segment} should follow its torso-relative ratio`,
    );
  }
  assert.ok(
    Math.abs(length(pose.shoulder_left, pose.elbow_left) - length(pose.shoulder_right, pose.elbow_right)) < 1e-10,
    "upper arms should be symmetrical",
  );
  assert.ok(
    Math.abs(length(pose.hip_left, pose.knee_left) - length(pose.hip_right, pose.knee_right)) < 1e-10,
    "thighs should be symmetrical",
  );
});
