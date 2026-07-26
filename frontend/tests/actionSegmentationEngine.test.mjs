import assert from "node:assert/strict";
import test from "node:test";

import { ActionSegmentationEngine } from "../src/temporal/actionSegmentationEngine.js";

function update(engine, timestampMs, overrides = {}) {
  return engine.update({
    timestampMs,
    trackingConfidence: 0.95,
    motionEnergy: 0,
    stepProbability: 0,
    mistakeRisk: 0,
    currentStepId: 2,
    currentStepName: "Extend punch",
    ...overrides
  });
}

test("segmentation stabilizes preparation and step labels across frames", () => {
  const engine = new ActionSegmentationEngine({ stableFrames: 2 });

  assert.equal(update(engine, 0).motion_phase, "idle");
  assert.equal(update(engine, 33, { motionEnergy: 0.06 }).motion_phase, "idle");
  const preparation = update(engine, 66, { motionEnergy: 0.06 });
  assert.equal(preparation.motion_phase, "preparation");
  assert.equal(preparation.event.type, "movement_onset");

  update(engine, 99, { motionEnergy: 0.06, stepProbability: 0.75 });
  const active = update(engine, 132, { motionEnergy: 0.05, stepProbability: 0.78 });
  assert.equal(active.motion_phase, "step_active");
  assert.equal(active.frame_label, "step_2");
  assert.equal(active.event.type, "step_entry");
});

test("segmentation detects peak extension when score is high and motion decelerates", () => {
  const engine = new ActionSegmentationEngine({ stableFrames: 1 });

  update(engine, 0, { motionEnergy: 0.08, stepProbability: 0.75 });
  const peak = update(engine, 33, { motionEnergy: 0.03, stepProbability: 0.9 });

  assert.equal(peak.motion_phase, "peak_extension");
  assert.equal(peak.event.type, "peak_extension");
  assert.equal(peak.boundary.phase_changed, true);
});

test("tracking loss becomes immediate and produces a recovery event", () => {
  const engine = new ActionSegmentationEngine({ stableFrames: 3 });

  update(engine, 0);
  const lost = update(engine, 33, { trackingConfidence: 0.2 });
  const recovered = update(engine, 66);
  update(engine, 99);
  const stableRecovery = update(engine, 132);

  assert.equal(lost.motion_phase, "tracking_lost");
  assert.equal(lost.event.type, "tracking_lost");
  assert.equal(recovered.motion_phase, "tracking_lost");
  assert.equal(stableRecovery.motion_phase, "idle");
  assert.equal(stableRecovery.event.type, "tracking_recovered");
});

test("change-point output exposes score, energy, and confidence signals", () => {
  const engine = new ActionSegmentationEngine({ stableFrames: 1 });

  update(engine, 0, { motionEnergy: 0.01, stepProbability: 0.1 });
  const changed = update(engine, 33, {
    motionEnergy: 0.08,
    stepProbability: 0.8,
    trackingConfidence: 0.6
  });

  assert.ok(changed.change_point.score > 0);
  assert.ok(changed.change_point.motion_energy_change > 0);
  assert.ok(changed.change_point.pose_score_change > 0);
  assert.ok(changed.change_point.confidence_drop > 0);
});
