import assert from "node:assert/strict";
import test from "node:test";

import {
  interpolateGuideArticulation,
  interpolateGuideLandmarks,
} from "../src/utils/guideSkeletonAnimation.js";

test("Guide interpolation preserves landmark names for bone lookup", () => {
  const first = { head: [0, 1, 0], shoulder_left: [-1, 0, 0] };
  const second = { head: [0, 2, 0], shoulder_left: [-2, 0, 0] };

  const result = interpolateGuideLandmarks(first, second, 0.5);

  assert.deepEqual(Object.keys(result), ["head", "shoulder_left"]);
  assert.deepEqual(result.head, [0, 1.5, 0]);
  assert.deepEqual(result.shoulder_left, [-1.5, 0, 0]);
});

test("Guide articulation interpolates gaze and fist state", () => {
  const result = interpolateGuideArticulation(
    { face: { gaze_horizontal: 0 }, hand_left: { fist_closure: 0, wrist_rotation: [0, 0, 0] } },
    { face: { gaze_horizontal: 1 }, hand_left: { fist_closure: 1, wrist_rotation: [0, 1, 0] } },
    0.5,
  );

  assert.equal(result.face.gaze_horizontal, 0.5);
  assert.equal(result.hand_left.fist_closure, 0.5);
  assert.deepEqual(result.hand_left.wrist_rotation, [0, 0.5, 0]);
});
