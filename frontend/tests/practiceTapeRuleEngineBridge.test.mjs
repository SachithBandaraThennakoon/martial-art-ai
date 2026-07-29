import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachRuleEngineAnalysisToTape,
  reanalyzePracticeTapeWithRuleEngine
} from "../src/tracking/practiceTapeRuleEngineBridge.js";
import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import { loadTechniqueSource } from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function loadJabPackage() {
  const directory = path.resolve(
    testDirectory,
    "../../backend/data/techniques/jab"
  );
  return createTechniquePackage(
    await loadTechniqueSource(path.dirname(directory), "jab")
  );
}

test("Practice tape frames retain raw and corrected rule-engine labels", () => {
  const tape = [
    { sourceTimestampMs: 1000, frame: 1 },
    { sourceTimestampMs: 1040, frame: 2 }
  ];
  const rawFrames = [
    {
      timestamp_ms: 1002,
      step: "EXTENSION",
      phase: "HOLD",
      rep_id: 1,
      rep_state: "REP_ACTIVE",
      tracking_lost: false
    },
    {
      timestamp_ms: 1042,
      step: "GUARD",
      phase: "ENTRY",
      rep_id: 1,
      rep_state: "REP_ACTIVE",
      tracking_lost: false
    }
  ];
  const correctedFrames = [
    {
      ...rawFrames[0],
      post_session_corrected: false
    },
    {
      ...rawFrames[1],
      step: "EXTENSION",
      phase: "HOLD",
      post_session_corrected: true
    }
  ];

  const attached = attachRuleEngineAnalysisToTape(tape, {
    rawFrames,
    correctedFrames
  });

  assert.equal(attached[0].ruleEngineAnalysis.changed, false);
  assert.equal(attached[1].ruleEngineAnalysis.changed, true);
  assert.equal(
    attached[1].ruleEngineAnalysis.raw.step,
    "GUARD"
  );
  assert.equal(
    attached[1].ruleEngineAnalysis.corrected.step,
    "EXTENSION"
  );
});

test("unmatched tape timestamps remain explicit instead of borrowing distant states", () => {
  const [frame] = attachRuleEngineAnalysisToTape(
    [{ sourceTimestampMs: 5000 }],
    {
      rawFrames: [{ timestamp_ms: 1000, step: "GUARD" }],
      correctedFrames: [{ timestamp_ms: 1000, step: "GUARD" }],
      toleranceMs: 50
    }
  );

  assert.equal(frame.ruleEngineAnalysis.raw, null);
  assert.equal(frame.ruleEngineAnalysis.corrected, null);
  assert.equal(frame.ruleEngineAnalysis.changed, false);
});

test("legacy tape can be replayed through the current temporal rule engine", async () => {
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    index,
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1
  }));
  Object.assign(landmarks[11], { x: 0.4, y: 0.3 });
  Object.assign(landmarks[12], { x: 0.6, y: 0.3 });
  Object.assign(landmarks[15], { x: 0.4, y: 0.5 });
  Object.assign(landmarks[16], { x: 0.6, y: 0.5 });
  Object.assign(landmarks[23], { x: 0.42, y: 0.65 });
  Object.assign(landmarks[24], { x: 0.58, y: 0.65 });

  const frames = [0, 40, 80, 120].map((timestampMs, index) => ({
    frame: index + 1,
    elapsedMs: timestampMs,
    sourceTimestampMs: timestampMs,
    measurementLandmarks: landmarks,
    angles: { elbow_left: 90 },
    trackingConfidence: 0.98
  }));
  const replayed = reanalyzePracticeTapeWithRuleEngine(
    frames,
    await loadJabPackage()
  );

  assert.ok(replayed);
  assert.equal(replayed.ruleEngineAnalysis.summary.technique, "JAB");
  assert.equal(replayed.frames.length, frames.length);
  assert.ok(replayed.frames.at(-1).ruleEngineAnalysis.corrected);
  assert.equal(
    replayed.frames.at(-1).ruleEngineAnalysis.corrected.step,
    "GUARD"
  );
});

test("Practice Step 2 preserves a confirmed open striking-hand error", async () => {
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    index,
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1
  }));
  Object.assign(landmarks[11], { x: 0.4, y: 0.3 });
  Object.assign(landmarks[12], { x: 0.6, y: 0.3 });
  Object.assign(landmarks[13], { x: 0.38, y: 0.4 });
  Object.assign(landmarks[15], { x: 0.36, y: 0.5 });
  Object.assign(landmarks[16], { x: 0.6, y: 0.5 });
  Object.assign(landmarks[23], { x: 0.42, y: 0.65 });
  Object.assign(landmarks[24], { x: 0.58, y: 0.65 });

  const frames = [0, 40, 80, 120, 160].map((timestampMs, index) => ({
    frame: index + 1,
    elapsedMs: timestampMs,
    sourceTimestampMs: timestampMs,
    measurementLandmarks: landmarks,
    angles: {
      elbow_left: 90,
      fist_left: 10,
      fist_right: 90
    },
    step: 2,
    phase: "hold",
    scorable: true,
    trackingConfidence: 0.98
  }));
  const replayed = reanalyzePracticeTapeWithRuleEngine(
    frames,
    await loadJabPackage()
  );

  assert.ok(
    replayed.frames.some((frame) =>
      frame.ruleEngineAnalysis.corrected?.form_errors?.includes(
        "open_lead_hand_during_strike"
      )
    )
  );
});
