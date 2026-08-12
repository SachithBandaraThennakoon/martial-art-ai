import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePositionFeedback,
  normalizeLivePoseForReference
} from "../src/utils/positionFeedback.js";

function pose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  points[11] = { x: -0.5, y: -1, z: 0, visibility: 1 };
  points[12] = { x: 0.5, y: -1, z: 0, visibility: 1 };
  points[23] = { x: -0.35, y: 0, z: 0, visibility: 1 };
  points[24] = { x: 0.35, y: 0, z: 0, visibility: 1 };
  points[15] = { x: -0.4, y: -0.55, z: 0, visibility: 1 };
  points[16] = { x: 0.4, y: -0.55, z: 0, visibility: 1 };
  return points;
}

const referencePose = {
  coordinate_space: "body_normalized_v1",
  tolerance: 0.1,
  landmarks: {
    shoulder_left: [-0.5, 1, 0],
    shoulder_right: [0.5, 1, 0],
    hip_left: [-0.35, 0, 0],
    hip_right: [0.35, 0, 0],
    wrist_left: [-0.4, 0.85, 0],
    wrist_right: [0.4, 0.55, 0]
  }
};

test("normalizes live positions around hips using torso length", () => {
  const normalized = normalizeLivePoseForReference(pose(), referencePose.landmarks);
  assert.ok(normalized);
  assert.equal(Math.round(normalized.shoulder_left.y * 10) / 10, 1);
  assert.equal(Math.round(normalized.hip_right.y * 10) / 10, 0);
});

test("generates a directional correction for a visible misplaced landmark", () => {
  const corrections = evaluatePositionFeedback({
    livePose: pose(),
    referencePose,
    positionTargets: [{ body_part: "wrist_left", axes: ["y"], tolerance: 0.1 }]
  });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].bodyPart, "wrist_left");
  assert.equal(corrections[0].direction, "raise");
});

test("does not correct an occluded landmark", () => {
  const live = pose();
  live[15].visibility = 0.2;
  const corrections = evaluatePositionFeedback({
    livePose: live,
    referencePose,
    positionTargets: [{ body_part: "wrist_left" }]
  });
  assert.deepEqual(corrections, []);
});

test("uses normalized depth for cautious forward and backward feedback", () => {
  const live = pose();
  live[15].z = 0.35;
  const corrections = evaluatePositionFeedback({
    livePose: live,
    referencePose: {
      ...referencePose,
      landmarks: { ...referencePose.landmarks, wrist_left: [-0.4, 0.55, 0.4] }
    },
    positionTargets: [{
      body_part: "wrist_left",
      axes: ["z"],
      tolerance: { z: 0.1 }
    }]
  });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].axis, "z");
  assert.equal(corrections[0].direction, "forward");
});

test("requires stronger visibility before giving depth feedback", () => {
  const live = pose();
  live[15] = { ...live[15], z: 0.35, visibility: 0.6 };
  const corrections = evaluatePositionFeedback({
    livePose: live,
    referencePose: {
      ...referencePose,
      landmarks: { ...referencePose.landmarks, wrist_left: [-0.4, 0.55, 0.4] }
    },
    positionTargets: [{ body_part: "wrist_left", axes: ["z"] }]
  });
  assert.deepEqual(corrections, []);
});
