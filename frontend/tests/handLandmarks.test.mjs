import assert from "node:assert/strict";
import test from "node:test";

import { buildHandLandmarks } from "../src/skeleton/handLandmarks.js";

const pose = {
  head: [0, 1.65, 0],
  shoulder_left: [-0.52, 1.15, 0],
  shoulder_right: [0.52, 1.15, 0],
  elbow_left: [-0.84, 0.67, 0.02],
  elbow_right: [0.84, 0.67, 0.02],
  wrist_left: [-0.62, 0.18, 0.05],
  wrist_right: [0.62, 0.18, 0.05],
};

function articulation(closure, palmTurn = 0) {
  return {
    hand_left: { fist_closure: closure, finger_spread: 0.35, palm_turn: palmTurn, wrist_rotation: [0, 0, 0] },
    hand_right: { fist_closure: closure, finger_spread: 0.35, palm_turn: palmTurn, wrist_rotation: [0, 0, 0] },
  };
}

function distance(first, second) {
  return Math.hypot(...first.map((value, axis) => value - second[axis]));
}

test("closed fingertips curve back into the palm", () => {
  const open = buildHandLandmarks(pose, articulation(0), "left");
  const closed = buildHandLandmarks(pose, articulation(1), "left");
  const wrist = closed[0];
  const palmCenter = wrist.map(
    (value, axis) => value + (pose.wrist_left[axis] - pose.elbow_left[axis]) * 0.08,
  );

  for (const fingertip of [8, 12, 16, 20]) {
    assert.ok(
      distance(closed[fingertip], palmCenter) < distance(open[fingertip], palmCenter) * 0.55,
      `finger ${fingertip} should finish close to the palm`,
    );
  }
});

test("the distal finger segment points back toward the palm when closed", () => {
  const closed = buildHandLandmarks(pose, articulation(1), "left");
  for (const [middle, tip] of [[7, 8], [11, 12], [15, 16], [19, 20]]) {
    const distalDirection = closed[tip].map((value, axis) => value - closed[middle][axis]);
    const forearmDirection = pose.wrist_left.map((value, axis) => value - pose.elbow_left[axis]);
    const dot = distalDirection.reduce((sum, value, axis) => sum + value * forearmDirection[axis], 0);
    assert.ok(dot < 0, `finger ${tip} should curl back toward the palm`);
  }
});

test("the closed thumb tip locks across the final index and middle joints", () => {
  const closed = buildHandLandmarks(pose, articulation(1), "left");
  const lockCenter = closed[7].map(
    (value, axis) => (value + closed[11][axis]) / 2,
  );
  assert.ok(
    distance(closed[4], lockCenter) < 0.012,
    "thumb tip should rest over the curled index and middle fingers",
  );
  assert.ok(distance(closed[3], closed[4]) > 0.015, "thumb must retain its final bone");
});

test("closed fingertips and thumb remain on the same palm side", () => {
  for (const side of ["left", "right"]) {
    const closed = buildHandLandmarks(pose, articulation(1), side);
    const forward = subtract(closed[9], closed[0]);
    const width = subtract(closed[17], closed[5]);
    const palmSide = cross(forward, width);
    const thumbSide = dot(subtract(closed[4], closed[0]), palmSide);
    assert.ok(Math.abs(thumbSide) > 0.0001, `${side} thumb should identify the palm side`);
    for (const fingertip of [8, 12, 16, 20]) {
      assert.ok(
        dot(subtract(closed[fingertip], closed[0]), palmSide) * thumbSide > 0,
        `${side} finger ${fingertip} must not cross behind the hand`,
      );
    }
  }
});

test("the thumb begins wrapping across the fist at partial closure", () => {
  const open = buildHandLandmarks(pose, articulation(0), "left");
  const partial = buildHandLandmarks(pose, articulation(0.52), "left");
  const partialLockCenter = partial[7].map(
    (value, axis) => (value + partial[11][axis]) / 2,
  );
  assert.ok(
    distance(partial[4], partialLockCenter) <
      distance(open[4], partialLockCenter) * 0.62,
    "half-closed thumb should already cover the index and middle fingers",
  );
  assert.ok(distance(partial[1], partial[2]) > 0.008);
  assert.ok(distance(partial[2], partial[3]) > 0.008);
  assert.ok(distance(partial[3], partial[4]) > 0.008);
});

function subtract(first, second) {
  return first.map((value, axis) => value - second[axis]);
}

function dot(first, second) {
  return first.reduce((sum, value, axis) => sum + value * second[axis], 0);
}

function cross(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

test("guard fist palm faces inward and strike fist pronates without leaving the forearm axis", () => {
  const guard = buildHandLandmarks(pose, articulation(1, 0), "left");
  const strike = buildHandLandmarks(pose, articulation(1, 1), "left");
  const bodyCenter = pose.shoulder_left.map(
    (value, axis) => (value + pose.shoulder_right[axis]) / 2,
  );
  const firstFingerCurl = (landmarks) => subtract(landmarks[6], landmarks[5]);
  assert.ok(dot(firstFingerCurl(guard), subtract(bodyCenter, pose.wrist_left)) > 0);
  assert.ok(dot(firstFingerCurl(strike), [0, -1, 0]) > 0);
  const forearm = subtract(pose.wrist_left, pose.elbow_left);
  const handDirection = subtract(strike[9], strike[0]);
  assert.ok(dot(forearm, handDirection) > 0, "front knuckles must continue toward the target");
});

test("manual wrist rotation rolls the fist without turning it away from the forearm", () => {
  const neutralSettings = articulation(1, 0);
  const rotatedSettings = articulation(1, 0);
  rotatedSettings.hand_left.wrist_rotation = [0.65, 0.4, -0.5];
  const neutral = buildHandLandmarks(pose, neutralSettings, "left");
  const rotated = buildHandLandmarks(pose, rotatedSettings, "left");
  const neutralWidth = subtract(neutral[17], neutral[5]);
  const rotatedWidth = subtract(rotated[17], rotated[5]);
  assert.ok(distance(neutralWidth, rotatedWidth) > 0.02, "rotation controls must visibly roll the fist");
  const forearm = subtract(pose.wrist_left, pose.elbow_left);
  assert.ok(dot(forearm, subtract(rotated[9], rotated[0])) > 0);
});
