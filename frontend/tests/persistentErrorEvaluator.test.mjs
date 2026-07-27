import assert from "node:assert/strict";
import test from "node:test";

import { PersistentErrorEvaluator } from "../src/tracking/persistentErrorEvaluator.js";

const droppedGuardRule = {
  id: "dropped_guard",
  severity: "form",
  evaluate_during: ["EXTENSION"],
  condition: {
    feature: "rear_wrist_guard_distance",
    operator: "gte",
    value: 0.55
  },
  confirmation: {
    min_frames: 4,
    min_ms: 100
  }
};

test("form errors require frame and elapsed-time confirmation", () => {
  const evaluator = new PersistentErrorEvaluator([droppedGuardRule]);
  const update = (timestampMs, value) =>
    evaluator.update({
      timestampMs,
      state: "EXTENSION",
      features: { rear_wrist_guard_distance: value },
      trackingConfidence: 0.95
    });

  assert.equal(update(0, 0.7).events.length, 0);
  assert.equal(update(40, 0.7).events.length, 0);
  assert.equal(update(80, 0.7).events.length, 0);
  const confirmed = update(120, 0.7);

  assert.equal(confirmed.events.length, 1);
  assert.equal(confirmed.events[0].type, "form_error_detected");
  assert.equal(confirmed.active_errors[0].error_id, "dropped_guard");
});

test("one noisy form-error frame never becomes an occurrence", () => {
  const evaluator = new PersistentErrorEvaluator([droppedGuardRule]);

  evaluator.update({
    timestampMs: 0,
    state: "EXTENSION",
    features: { rear_wrist_guard_distance: 0.7 },
    trackingConfidence: 0.95
  });
  evaluator.update({
    timestampMs: 40,
    state: "EXTENSION",
    features: { rear_wrist_guard_distance: 0.3 },
    trackingConfidence: 0.95
  });

  assert.equal(evaluator.getOccurrences().length, 0);
});

test("confirmed errors emit a clear event when the condition recovers", () => {
  const evaluator = new PersistentErrorEvaluator([droppedGuardRule]);
  for (const timestampMs of [0, 40, 80, 120]) {
    evaluator.update({
      timestampMs,
      state: "EXTENSION",
      features: { rear_wrist_guard_distance: 0.7 },
      trackingConfidence: 0.95
    });
  }
  const cleared = evaluator.update({
    timestampMs: 160,
    state: "EXTENSION",
    features: { rear_wrist_guard_distance: 0.3 },
    trackingConfidence: 0.95
  });

  assert.equal(cleared.events[0].type, "form_error_cleared");
  assert.equal(cleared.active_errors.length, 0);
});

test("a confirmed Practice strike step can evaluate an error when temporal clustering lags", () => {
  const evaluator = new PersistentErrorEvaluator([{
    id: "open_lead_hand_during_strike",
    severity: "form",
    evaluate_during: ["EXTENSION"],
    evaluate_practice_steps: [2],
    condition: {
      feature: "lead_fist_closure_score",
      operator: "lt",
      value: 55
    },
    confirmation: {
      min_frames: 4,
      min_ms: 120
    }
  }]);

  let result;
  for (const timestampMs of [0, 40, 80, 120]) {
    result = evaluator.update({
      timestampMs,
      state: "GUARD",
      features: { lead_fist_closure_score: 10 },
      trackingConfidence: 0.95,
      evaluationContext: {
        practice_step: 2,
        scorable: true
      }
    });
  }

  assert.equal(result.active_errors[0].error_id, "open_lead_hand_during_strike");
  assert.equal(result.active_errors[0].evaluation_context, "practice_step");
});
