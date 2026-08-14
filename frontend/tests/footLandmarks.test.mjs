import assert from "node:assert/strict";
import test from "node:test";

import { createAnatomicalDefaultPose } from "../src/skeleton/bodyProportions.js";
import { buildFootLandmarks } from "../src/skeleton/footLandmarks.js";

function distance(first, second) {
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

test("detailed feet include heel, ball, edges, and five toes", () => {
  const pose = createAnatomicalDefaultPose();
  const foot = buildFootLandmarks(pose, "right");

  assert.equal(foot.toes.length, 5);
  for (const point of [
    foot.heel,
    foot.innerHeel,
    foot.outerHeel,
    foot.innerMid,
    foot.outerMid,
    foot.ball,
    foot.innerBall,
    foot.outerBall,
    ...foot.toes,
  ]) {
    assert.equal(point.length, 3);
    assert.ok(point.every(Number.isFinite));
  }
  assert.ok(distance(foot.innerBall, foot.outerBall) > distance(foot.innerHeel, foot.outerHeel));
  assert.ok(foot.toes.every((toe) => distance(toe, foot.ball) > 0.03));
});

test("left and right detailed feet keep matching proportions", () => {
  const pose = createAnatomicalDefaultPose();
  const left = buildFootLandmarks(pose, "left");
  const right = buildFootLandmarks(pose, "right");

  assert.ok(Math.abs(
    distance(left.innerBall, left.outerBall) -
    distance(right.innerBall, right.outerBall),
  ) < 0.001);
  assert.ok(Math.abs(
    distance(left.heel, left.ball) - distance(right.heel, right.ball),
  ) < 0.001);
});

test("ball-of-foot shape retracts every toe behind the contact plane", () => {
  const pose = createAnatomicalDefaultPose();
  const foot = buildFootLandmarks(pose, "right", {
    strikingSurface: "ball_of_foot",
  });
  const ankleToBall = foot.ball.map((value, index) => value - foot.ankle[index]);
  const length = Math.hypot(...ankleToBall);
  const forward = ankleToBall.map((value) => value / length);
  const forwardPosition = (point) => point.reduce(
    (total, value, index) => total + (value - foot.ball[index]) * forward[index],
    0,
  );

  assert.ok(
    foot.toes.every((toe) => forwardPosition(toe) < 0),
    "the ball must remain ahead of all five retracted toes",
  );
});

test("ball-of-foot retraction interpolates without changing the other foot", () => {
  const pose = createAnatomicalDefaultPose();
  const neutral = buildFootLandmarks(pose, "right", { ballOfFootProgress: 0 });
  const halfway = buildFootLandmarks(pose, "right", { ballOfFootProgress: 0.5 });
  const contact = buildFootLandmarks(pose, "right", { ballOfFootProgress: 1 });
  const supportingFoot = buildFootLandmarks(pose, "left", { ballOfFootProgress: 0 });

  assert.ok(distance(neutral.ball, halfway.ball) > 0);
  assert.ok(Math.abs(
    distance(neutral.ball, halfway.ball) - distance(halfway.ball, contact.ball),
  ) < 0.001);
  assert.deepEqual(
    supportingFoot,
    buildFootLandmarks(pose, "left", { ballOfFootProgress: 0 }),
  );
});
