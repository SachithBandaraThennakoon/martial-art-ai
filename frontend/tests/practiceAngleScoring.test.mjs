import assert from "node:assert/strict";
import test from "node:test";

import { scorePracticeAngles } from "../src/utils/practiceAngleScoring.js";

const JAB_EXTENSION_TARGETS = [
  { body_part: "elbow_left", min: 145, max: 180 },
  { body_part: "shoulder_left", min: 65, max: 110 },
  { body_part: "fist_left", min: 75, max: 100 }
];

test("a bent Jab elbow cannot be hidden by perfect shoulder and fist targets", () => {
  const result = scorePracticeAngles(JAB_EXTENSION_TARGETS, {
    elbow_left: 127,
    shoulder_left: 85,
    fist_left: 90
  });

  assert.equal(result.accuracy, 64);
  assert.equal(result.focusBodyPart, "elbow_left");
  assert.equal(result.issue, "too_closed");
  assert.deepEqual(result.wrongBodyParts, ["elbow_left"]);
});

test("a fully extended Jab scores clean when every required target is valid", () => {
  const result = scorePracticeAngles(JAB_EXTENSION_TARGETS, {
    elbow_left: 165,
    shoulder_left: 88,
    fist_left: 92
  });

  assert.equal(result.accuracy, 100);
  assert.deepEqual(result.wrongBodyParts, []);
});

test("missing required tracking data makes the keyframe unscorable", () => {
  const result = scorePracticeAngles(JAB_EXTENSION_TARGETS, {
    shoulder_left: 88,
    fist_left: 92
  });

  assert.equal(result.accuracy, 0);
  assert.equal(result.focusBodyPart, "elbow_left");
  assert.equal(result.issue, "missing");
});
