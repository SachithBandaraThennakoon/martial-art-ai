import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { postProcessSessionTimeline } from "../src/tracking/sessionTimelinePostProcessor.js";
import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import { loadTechniqueSource } from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const techniqueRoot = path.resolve(testDirectory, "../../backend/data/techniques");

async function loadTechniquePackage(techniqueId) {
  return createTechniquePackage(
    await loadTechniqueSource(techniqueRoot, techniqueId)
  );
}

function frame(timestampMs, step, overrides = {}) {
  return {
    timestamp: timestampMs / 1000,
    timestamp_ms: timestampMs,
    session_state: "ACTIVE",
    technique: "JAB",
    rep_id: null,
    rep_state: "WAITING",
    step,
    phase: "HOLD",
    confidence: 0.9,
    tracking_confidence: 0.95,
    tracking_lost: false,
    unknown_movement: false,
    form_errors: [],
    cue_timing_ms: null,
    ...overrides
  };
}

test("post-processing repairs gaps, removes microstates, and recounts Jab reps", async () => {
  const techniquePackage = await loadTechniquePackage("jab");
  const frames = [
    frame(0, "GUARD"),
    frame(40, "GUARD"),
    frame(80, "GUARD"),
    frame(120, "EXTENSION", { cue_timing_ms: 120 }),
    frame(160, "EXTENSION"),
    frame(200, "GUARD"),
    frame(240, "EXTENSION"),
    frame(280, "FULL_EXTENSION"),
    frame(320, "FULL_EXTENSION"),
    frame(360, "FULL_EXTENSION"),
    frame(400, "FULL_EXTENSION", {
      tracking_lost: true,
      tracking_confidence: 0.2
    }),
    frame(440, "FULL_EXTENSION"),
    frame(480, "RETRACTION"),
    frame(520, "RETRACTION"),
    frame(560, "RECOVERY"),
    frame(600, "RECOVERY"),
    frame(640, "GUARD"),
    frame(680, "GUARD")
  ];

  const corrected = postProcessSessionTimeline({
    frames,
    techniquePackage,
    config: {
      minimum_state_duration_ms: 70,
      maximum_repairable_tracking_gap_ms: 100
    }
  });

  assert.equal(corrected.summary.total_repetitions, 1);
  assert.equal(corrected.summary.completed_repetitions, 1);
  assert.equal(corrected.summary.aborted_repetitions, 0);
  assert.deepEqual(corrected.repetitions[0].state_sequence, [
    "GUARD",
    "EXTENSION",
    "FULL_EXTENSION",
    "RETRACTION",
    "RECOVERY",
    "GUARD"
  ]);
  assert.ok(corrected.corrections.some(
    (correction) => correction.type === "FALSE_MICROSTATE_REMOVED"
  ));
  assert.ok(corrected.corrections.some(
    (correction) => correction.type === "BRIEF_TRACKING_GAP_REPAIRED"
  ));
  assert.equal(corrected.frames[5].step, "EXTENSION");
  assert.equal(corrected.frames[10].tracking_repaired, true);
  assert.equal(corrected.frames[3].rep_state, "REP_STARTED");
  assert.equal(corrected.frames[16].rep_state, "REP_COMPLETED");
});

test("impossible transitions are rejected instead of forced into a repetition", async () => {
  const corrected = postProcessSessionTimeline({
    techniquePackage: await loadTechniquePackage("jab"),
    frames: [
      frame(0, "GUARD"),
      frame(40, "GUARD"),
      frame(80, "GUARD"),
      frame(120, "FULL_EXTENSION"),
      frame(160, "FULL_EXTENSION"),
      frame(200, "FULL_EXTENSION"),
      frame(240, "GUARD"),
      frame(280, "GUARD")
    ]
  });

  assert.equal(corrected.summary.total_repetitions, 0);
  assert.ok(corrected.corrections.some(
    (correction) => correction.type === "IMPOSSIBLE_TRANSITION_REJECTED"
  ));
  assert.equal(corrected.frames[3].step, null);
  assert.equal(corrected.frames[3].rejected_transition, true);
});

test("an ordered but unfinished movement is retained as an aborted repetition", async () => {
  const corrected = postProcessSessionTimeline({
    techniquePackage: await loadTechniquePackage("jab"),
    frames: [
      frame(0, "GUARD"),
      frame(40, "GUARD"),
      frame(80, "GUARD"),
      frame(120, "EXTENSION"),
      frame(160, "EXTENSION"),
      frame(200, "FULL_EXTENSION"),
      frame(240, "FULL_EXTENSION")
    ]
  });

  assert.equal(corrected.summary.total_repetitions, 1);
  assert.equal(corrected.summary.completed_repetitions, 0);
  assert.equal(corrected.summary.aborted_repetitions, 1);
  assert.equal(corrected.repetitions[0].status, "aborted_session_end");
  assert.equal(corrected.repetitions[0].incomplete, true);
});
