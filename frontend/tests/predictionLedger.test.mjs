import assert from "node:assert/strict";
import test from "node:test";

import { Level1MotionLayer } from "../src/temporal/level1MotionLayer.js";
import {
  PredictionLedger,
  selectPredictionAwareDisplayPose
} from "../src/temporal/predictionLedger.js";

const pose = (x) => [
  { x, y: x, z: 0, visibility: 1 },
  { x: x + 0.1, y: x + 0.2, z: 0, visibility: 1 }
];

test("Level 1 emits separate +1, +2 and +3 forecast frames", () => {
  const layer = new Level1MotionLayer();
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    x: 0.3 + index * 0.001,
    y: 0.4 + index * 0.001,
    z: 0,
    visibility: 1
  }));

  layer.update(landmarks, 1000);
  const state = layer.update(
    landmarks.map((point) => ({ ...point, x: point.x + 0.01 })),
    1000 + 1000 / 30
  );

  assert.deepEqual(
    state.debug.predictedFrames.map((frame) => frame.horizonFrame),
    [1, 2, 3]
  );
  assert.deepEqual(
    state.debug.predictedFrames.map((frame) => Math.round(frame.horizonMs)),
    [33, 67, 100]
  );
});

test("one target frame aggregates three Level 1 and thirty Level 2 forecasts", () => {
  const ledger = new PredictionLedger();
  const targetTimestampMs = 3000;

  for (let horizonFrame = 1; horizonFrame <= 3; horizonFrame += 1) {
    ledger.addForecast({
      model: "level1",
      originTimestampMs: targetTimestampMs - horizonFrame * (1000 / 30),
      targetTimestampMs,
      horizonFrame,
      landmarks: pose(0.5),
      confidence: 0.9
    });
  }
  for (let horizonFrame = 1; horizonFrame <= 30; horizonFrame += 1) {
    ledger.addForecast({
      model: "level2",
      originTimestampMs: targetTimestampMs - horizonFrame * (1000 / 30),
      targetTimestampMs,
      horizonFrame,
      landmarks: pose(0.51),
      confidence: 0.8
    });
  }

  const result = ledger.resolve({
    targetTimestampMs,
    observedLandmarks: pose(0.49),
    observedConfidence: 0.95
  });

  assert.deepEqual(result.sourceCounts, {
    observed: 1,
    level1: 3,
    level2: 30,
    total: 34
  });
  assert.equal(result.forecasts.length, 33);
  assert.equal(result.usePredictionFallback, false);
  assert.ok(result.aggregateLandmarks[0].x > 0.49);
  assert.ok(result.aggregateLandmarks[0].x < 0.51);
});

test("low-confidence observations activate prediction fallback", () => {
  const ledger = new PredictionLedger();
  ledger.addForecast({
    model: "level1",
    originTimestampMs: 900,
    targetTimestampMs: 1000,
    horizonFrame: 3,
    landmarks: pose(0.4),
    confidence: 0.9
  });

  const result = ledger.resolve({
    targetTimestampMs: 1000,
    observedLandmarks: pose(0.8),
    observedConfidence: 0.2
  });

  assert.equal(result.usePredictionFallback, true);
  assert.equal(result.sourceCounts.level1, 1);
  assert.ok(result.aggregateLandmarks[0].x < 0.5);
  assert.ok(result.agreementError > 0.3);
});

test("the ledger deduplicates repeated model sequences", () => {
  const ledger = new PredictionLedger();
  const sequence = {
    model: "level2",
    originTimestampMs: 1000,
    confidence: 0.8,
    forecasts: [
      {
        target_timestamp_ms: 1033.33,
        horizon_frame: 1,
        landmarks: pose(0.5)
      }
    ]
  };

  ledger.addSequence(sequence);
  ledger.addSequence(sequence);
  const result = ledger.resolve({
    targetTimestampMs: 1033.33,
    observedLandmarks: pose(0.5),
    observedConfidence: 1
  });

  assert.equal(result.sourceCounts.level2, 1);
});

test("display selection keeps reliable observations independent from predictions", () => {
  const selection = selectPredictionAwareDisplayPose({
    observedLandmarks: pose(0.5),
    aggregateLandmarks: pose(0.52),
    predictedLandmarks: pose(0.55),
    observedConfidence: 0.94,
    agreementError: 0.05,
    usePredictionFallback: false,
    sourceCounts: { level1: 3, level2: 2 }
  });

  assert.equal(selection.source, "observed");
  assert.deepEqual(selection.landmarks, pose(0.5));
});

test("display selection uses prediction-only pose when observation confidence is low", () => {
  const selection = selectPredictionAwareDisplayPose({
    observedLandmarks: pose(0.9),
    aggregateLandmarks: pose(0.45),
    predictedLandmarks: pose(0.4),
    observedConfidence: 0.2,
    agreementError: 0.5,
    usePredictionFallback: true,
    sourceCounts: { level1: 3, level2: 4 }
  });

  assert.equal(selection.source, "prediction_fallback");
  assert.deepEqual(selection.landmarks, pose(0.4));
});

test("display selection blends medium-confidence observations only when forecasts agree", () => {
  const selection = selectPredictionAwareDisplayPose({
    observedLandmarks: pose(0.5),
    aggregateLandmarks: pose(0.51),
    predictedLandmarks: pose(0.52),
    observedConfidence: 0.65,
    agreementError: 0.02,
    usePredictionFallback: false,
    sourceCounts: { level1: 2, level2: 1 }
  });

  assert.equal(selection.source, "confidence_blend");
  assert.deepEqual(selection.landmarks, pose(0.51));
});
