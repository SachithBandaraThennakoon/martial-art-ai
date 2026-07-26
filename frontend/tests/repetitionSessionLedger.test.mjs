import assert from "node:assert/strict";
import test from "node:test";

import { RepetitionSessionLedger } from "../src/temporal/repetitionSessionLedger.js";

function observe(ledger, timestampMs, eventType = null, overrides = {}) {
  return ledger.observe({
    timestampMs,
    event: eventType
      ? { id: `${timestampMs}:${eventType}`, type: eventType, timestamp_ms: timestampMs }
      : null,
    phase: overrides.phase || "step_active",
    stepId: overrides.stepId ?? 1,
    stepName: overrides.stepName || "Extend",
    stepProbability: overrides.stepProbability ?? 0.9,
    mistakeRisk: overrides.mistakeRisk ?? 0.05,
    trackingConfidence: overrides.trackingConfidence ?? 0.95,
    techniqueName: "Jab"
  });
}

test("ledger converts temporal events into a completed repetition", () => {
  const ledger = new RepetitionSessionLedger();

  observe(ledger, 1000, "movement_onset");
  observe(ledger, 1100, "step_entry");
  observe(ledger, 1300, "peak_extension");
  const summary = observe(ledger, 1600, "repetition_end_candidate");

  assert.equal(summary.repetitions_completed, 1);
  assert.equal(summary.correct_repetitions, 1);
  assert.equal(summary.latest_repetition.duration_ms, 600);
  assert.equal(summary.latest_repetition.peak_ms, 1300);
  assert.equal(summary.latest_repetition.correctness, "correct");
});

test("ledger associates a count cue with response onset and reaction time", () => {
  const ledger = new RepetitionSessionLedger();
  ledger.recordCue({ cue: 1, timestampMs: 900 });

  observe(ledger, 1050, "movement_onset");
  observe(ledger, 1250, "peak_extension");
  const summary = observe(ledger, 1500, "repetition_end_candidate");

  assert.equal(summary.latest_repetition.cue, 1);
  assert.equal(summary.latest_repetition.reaction_time_ms, 150);
  assert.equal(summary.average_reaction_time_ms, 150);
  assert.equal(summary.unmatched_cues, 0);
});

test("session end preserves an unfinished repetition as incomplete", () => {
  const ledger = new RepetitionSessionLedger();

  observe(ledger, 1000, "movement_onset");
  observe(ledger, 1200, "step_entry");
  const summary = ledger.endSession(1700);

  assert.equal(summary.repetitions_detected, 1);
  assert.equal(summary.repetitions_completed, 0);
  assert.equal(summary.incomplete_repetitions, 1);
  assert.equal(summary.latest_repetition.correctness, "incomplete");
});

test("duplicate sparse events cannot create duplicate repetitions", () => {
  const ledger = new RepetitionSessionLedger();
  const event = { id: "1000:movement", type: "movement_onset", timestamp_ms: 1000 };
  const input = {
    timestampMs: 1000,
    event,
    phase: "preparation",
    stepProbability: 0.5,
    mistakeRisk: 0.1,
    trackingConfidence: 0.9
  };

  ledger.observe(input);
  ledger.observe({ ...input, timestampMs: 1033 });

  assert.equal(ledger.getSummary().active_repetition.repetition, 1);
  assert.equal(ledger.getSummary().repetitions_detected, 0);
});
