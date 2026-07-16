import assert from "node:assert/strict";
import test from "node:test";

import { assignHandSides } from "../src/utils/handSideAssignment.js";

function point(x, y, visibility = 0.95) {
  return { x, y, z: 0, visibility };
}

function handAt(x, y) {
  return [point(x, y)];
}

test("missing hand landmarks are safe while the hand model starts", () => {
  assert.deepEqual(assignHandSides(null, [], null), []);
});

test("visible left pose wrist wins over an incorrect handedness fallback", () => {
  const pose = [];
  pose[11] = point(0.7, 0.35);
  pose[13] = point(0.76, 0.27);
  pose[15] = point(0.8, 0.2);
  pose[12] = point(0.3, 0.35);
  pose[14] = point(0.75, 0.24, 0.1);
  pose[16] = point(0.79, 0.21, 0.1);

  const entries = assignHandSides(
    [handAt(0.81, 0.19)],
    pose,
    [[{ categoryName: "Right", score: 0.99 }]]
  );

  assert.equal(entries[0].side, "left");
});

test("two visible hands receive unique anatomical sides", () => {
  const pose = [];
  pose[15] = point(0.78, 0.25);
  pose[16] = point(0.22, 0.25);

  const entries = assignHandSides(
    [handAt(0.77, 0.24), handAt(0.23, 0.24)],
    pose,
    []
  );

  assert.deepEqual(entries.map((entry) => entry.side), ["left", "right"]);
});

test("handedness remains available when pose anchors are unavailable", () => {
  const entries = assignHandSides(
    [handAt(0.5, 0.5)],
    [],
    [[{ categoryName: "Left", score: 0.9 }]]
  );

  assert.equal(entries[0].side, "left");
});
