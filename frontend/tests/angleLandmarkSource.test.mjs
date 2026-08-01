import assert from "node:assert/strict";
import test from "node:test";

import {
  isImagePlaneAnglePart,
  selectAngleLandmarks
} from "../src/utils/angleLandmarkSource.js";
import { calculateAngle } from "../src/utils/calculateAngle.js";

const imagePose = [{ source: "image" }];
const worldPose = [{ source: "world" }];

test("arm flexion uses camera-plane landmarks", () => {
  assert.equal(isImagePlaneAnglePart("elbow_left"), true);
  assert.equal(isImagePlaneAnglePart("wrist_right"), true);
  assert.equal(selectAngleLandmarks("elbow_left", imagePose, worldPose), imagePose);
  assert.equal(selectAngleLandmarks("wrist_right", imagePose, worldPose), imagePose);
});

test("torso and leg measurements retain world landmarks", () => {
  assert.equal(selectAngleLandmarks("shoulder_left", imagePose, worldPose), worldPose);
  assert.equal(selectAngleLandmarks("knee_right", imagePose, worldPose), worldPose);
});

test("image landmarks remain a fallback when world landmarks are absent", () => {
  assert.equal(selectAngleLandmarks("hip_left", imagePose, null), imagePose);
});

test("camera-plane extension ignores unstable monocular depth", () => {
  const shoulder = { x: 0, y: 0, z: 0.4 };
  const elbow = { x: 1, y: 0, z: -0.3 };
  const wrist = { x: 2, y: 0, z: 0.5 };

  assert.equal(calculateAngle(shoulder, elbow, wrist), 180);
});
