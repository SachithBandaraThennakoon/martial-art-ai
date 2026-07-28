import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCountAttention,
  reclassifyPracticeSequence,
  trimPracticeTapeFrames
} from "../src/utils/practiceMovementClassifier.js";

const FRAME_MS = 1000 / 30;

const sample = (
  motionScore,
  stepScores,
  trackingConfidence = 0.95
) => ({ motionScore, stepScores, trackingConfidence });

const idle = (frames) =>
  Array.from({ length: frames }, () => sample(0, [20, 20, 20]));

const wrongMovement = (frames) =>
  Array.from({ length: frames }, () => sample(0.14, [84, 62, 18]));

const validJab = ({ completeRecovery = true } = {}) => [
  sample(0, [92, 12, 18]),
  sample(0, [94, 10, 17]),
  sample(0, [95, 10, 16]),
  sample(0, [95, 9, 16]),
  sample(0.06, [35, 45, 20]),
  sample(0.07, [25, 55, 20]),
  sample(0.09, [20, 82, 20]),
  sample(0.1, [16, 96, 18]),
  sample(0.09, [55, 40, 72]),
  sample(0.02, [86, 15, 92]),
  sample(0.01, [90, 12, 94]),
  sample(0.01, [91, 11, 95]),
  ...(completeRecovery
    ? [
        sample(0.01, [90, 12, 94]),
        sample(0.01, [90, 12, 94])
      ]
    : [])
];

const fastJab = () => [
  sample(0, [92, 10, 20]),
  sample(0, [94, 12, 18]),
  sample(0, [95, 11, 17]),
  sample(0, [95, 10, 17]),
  sample(0.05, [30, 45, 20]),
  sample(0.06, [25, 55, 20]),
  sample(0.12, [30, 66, 20]),
  sample(0.11, [60, 32, 68]),
  sample(0.02, [86, 15, 92]),
  sample(0.01, [90, 12, 94]),
  sample(0.01, [91, 11, 95]),
  sample(0.01, [90, 12, 94]),
  sample(0.01, [90, 12, 94])
];

function analyze(samples, countMarkers = [{ elapsedMs: 0 }]) {
  const source = samples.map((entry, index) => ({
    ...entry,
    frame: index + 1,
    elapsedMs: index * FRAME_MS,
    sourceTimestampMs: index * FRAME_MS
  }));
  const classified = reclassifyPracticeSequence(source, {
    countStep: 2,
    stepCount: 3,
    targetReps: 1,
    stableFrames: 2,
    exitFrames: 2,
    recoveryFrames: 2,
    evidenceRadius: 0
  });
  const withCueMetadata = attachCountAttention(
    classified,
    countMarkers,
    2000
  );
  return {
    classified,
    trimmed: trimPracticeTapeFrames(withCueMetadata, {
      paddingBeforeMs: 300,
      paddingAfterMs: 300,
      maximumLeadInMs: 2000,
      maximumRecoveryMs: 1500
    })
  };
}

const hasPeak = (frames) =>
  frames.some((frame) => frame.temporalPhase === "rep_peak");

const completed = (frames) =>
  frames.some(
    (frame) =>
      frame.temporalPhase === "session_complete" &&
      frame.completedRep === 1
  );

test("delayed response is detected and long count-to-movement wait is trimmed", () => {
  const result = analyze([
    ...idle(180),
    ...validJab(),
    ...idle(180)
  ]);

  assert.equal(hasPeak(result.classified), true);
  assert.equal(completed(result.classified), true);
  assert.ok(result.trimmed[0].sourceTimestampMs > 3000);
  assert.ok(result.trimmed.at(-1).sourceTimestampMs < 9000);
  assert.ok(result.trimmed[0].countTimestampMs < 0);
});

test("a fast sampled Jab still produces one completed repetition", () => {
  const result = analyze([
    ...idle(12),
    ...fastJab(),
    ...idle(12)
  ]);

  assert.equal(hasPeak(result.classified), true);
  assert.equal(completed(result.classified), true);
  assert.equal(
    result.classified.filter((frame) => frame.countedRep === 1).length,
    1
  );
});

test("wrong fast movement cannot become a Jab repetition", () => {
  const result = analyze([
    ...idle(12),
    sample(0, [95, 10, 15]),
    sample(0, [96, 10, 14]),
    ...wrongMovement(12),
    ...idle(12)
  ]);

  assert.equal(hasPeak(result.classified), false);
  assert.equal(completed(result.classified), false);
  assert.equal(
    result.classified.some((frame) => frame.countedRep === 1),
    false
  );
});

test("movement before the first count is analyzed because counts are metadata only", () => {
  const result = analyze(
    [...validJab(), ...idle(90)],
    [{ elapsedMs: 1500 }]
  );

  assert.equal(completed(result.classified), true);
  assert.ok(
    result.trimmed.some((frame) => Number(frame.countTimestampMs) > 0)
  );
});

test("irrelevant movement after the valid repetition is excluded from the tape", () => {
  const samples = [
    ...idle(15),
    ...validJab(),
    ...idle(15),
    ...wrongMovement(180)
  ];
  const result = analyze(samples);

  assert.equal(completed(result.classified), true);
  assert.ok(
    result.trimmed.at(-1).sourceTimestampMs <
      (samples.length - 100) * FRAME_MS
  );
});

test("brief tracking loss does not prevent a later valid repetition", () => {
  const trackingLoss = Array.from(
    { length: 6 },
    () => sample(0.1, [95, 10, 15], 0.2)
  );
  const result = analyze([
    ...idle(15),
    ...trackingLoss,
    ...idle(6),
    ...validJab(),
    ...idle(15)
  ]);

  assert.equal(
    result.classified.some((frame) => frame.temporalPhase === "tracking_lost"),
    true
  );
  assert.equal(completed(result.classified), true);
});

test("missing recovery remains an incomplete repetition", () => {
  const result = analyze([
    ...idle(12),
    ...validJab({ completeRecovery: false })
  ]);

  assert.equal(hasPeak(result.classified), true);
  assert.equal(completed(result.classified), false);
});
