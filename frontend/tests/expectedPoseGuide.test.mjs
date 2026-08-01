import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedPose,
  projectExpectedPose
} from "../src/utils/buildExpectedPose.js";

test("mirrored Jab guide extends the lead left arm on screen-left", () => {
  const pose = buildExpectedPose([], "Extend lead hand");
  const mirrored = projectExpectedPose(pose, 30, true);
  const standard = projectExpectedPose(pose, 30, false);

  assert.ok(mirrored.wrist_left.x < mirrored.shoulder_left.x);
  assert.ok(standard.wrist_left.x > standard.shoulder_left.x);
  assert.equal(
    Math.round(mirrored.wrist_left.x + standard.wrist_left.x),
    100
  );
});
