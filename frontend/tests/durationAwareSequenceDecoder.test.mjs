import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeDurationAwareSequence
} from "../src/tracking/durationAwareSequenceDecoder.js";
import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import { loadTechniqueSource } from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const jabDirectory = path.resolve(
  testDirectory,
  "../../backend/data/techniques/jab"
);

async function loadJab() {
  return createTechniquePackage(
    await loadTechniqueSource(path.dirname(jabDirectory), "jab")
  );
}

function evidenceFrame(timestampMs, state, overrides = {}) {
  const stateNames = [
    "GUARD",
    "EXTENSION",
    "FULL_EXTENSION",
    "RETRACTION",
    "RECOVERY"
  ];
  return {
    timestamp_ms: timestampMs,
    tracking_lost: false,
    step: overrides.liveStep || null,
    state_scores: Object.fromEntries(
      stateNames.map((stateName) => [
        stateName,
        stateName === state ? 0.96 : 0.04
      ])
    ),
    ...overrides
  };
}

function sequenceFrames(states, intervalMs = 40) {
  return states.map((state, index) =>
    evidenceFrame(index * intervalMs, state)
  );
}

test("offline decoder recovers the complete ordered Jab cycle", async () => {
  const jab = await loadJab();
  const frames = sequenceFrames([
    "GUARD", "GUARD", "GUARD", "GUARD",
    "EXTENSION", "EXTENSION",
    "FULL_EXTENSION", "FULL_EXTENSION",
    "RETRACTION", "RETRACTION",
    "RECOVERY", "RECOVERY", "RECOVERY",
    "GUARD", "GUARD", "GUARD", "GUARD"
  ]);

  const decoded = decodeDurationAwareSequence(
    frames,
    jab,
    jab.getMode("practice").offline_decoder
  );
  const compact = decoded.filter(
    (frame, index) => !index || frame.step !== decoded[index - 1].step
  ).map((frame) => frame.step);

  assert.deepEqual(compact, [
    "GUARD",
    "EXTENSION",
    "FULL_EXTENSION",
    "RETRACTION",
    "RECOVERY",
    "GUARD"
  ]);
});

test("the same decoder accepts fast and slow valid Jabs", async () => {
  const jab = await loadJab();
  const states = [
    "GUARD", "GUARD", "GUARD", "GUARD", "GUARD", "GUARD",
    "EXTENSION", "EXTENSION", "EXTENSION",
    "FULL_EXTENSION", "FULL_EXTENSION",
    "RETRACTION", "RETRACTION", "RETRACTION",
    "RECOVERY", "RECOVERY", "RECOVERY", "RECOVERY", "RECOVERY",
    "GUARD", "GUARD", "GUARD", "GUARD"
  ];

  for (const intervalMs of [20, 100]) {
    const decoded = decodeDurationAwareSequence(
      sequenceFrames(states, intervalMs),
      jab,
      jab.getMode("practice").offline_decoder
    );
    const compact = decoded.filter(
      (frame, index) => !index || frame.step !== decoded[index - 1].step
    ).map((frame) => frame.step);
    assert.deepEqual(compact, [
      "GUARD",
      "EXTENSION",
      "FULL_EXTENSION",
      "RETRACTION",
      "RECOVERY",
      "GUARD"
    ]);
  }
});

test("one noisy frame cannot insert an impossible state", async () => {
  const jab = await loadJab();
  const frames = sequenceFrames([
    "GUARD", "GUARD", "GUARD",
    "FULL_EXTENSION",
    "GUARD", "GUARD",
    "EXTENSION", "EXTENSION"
  ]);

  const decoded = decodeDurationAwareSequence(
    frames,
    jab,
    jab.getMode("practice").offline_decoder
  );

  assert.equal(decoded[3].step, "GUARD");
  assert.equal(decoded.some((frame) => frame.step === "FULL_EXTENSION"), false);
});

test("wrong ordered movement is unknown instead of becoming a repetition", async () => {
  const jab = await loadJab();
  const frames = sequenceFrames([
    "GUARD", "GUARD", "GUARD", "GUARD",
    "RECOVERY", "RECOVERY", "RECOVERY", "RECOVERY"
  ]);

  const decoded = decodeDurationAwareSequence(
    frames,
    jab,
    jab.getMode("practice").offline_decoder
  );

  assert.equal(decoded.some((frame) => frame.step === "RECOVERY"), false);
  assert.equal(decoded.slice(4).some((frame) => frame.unknown_movement), true);
});

test("tracking loss remains explicit and decoding restarts from guard", async () => {
  const jab = await loadJab();
  const frames = [
    ...sequenceFrames(["GUARD", "GUARD", "GUARD"], 40),
    {
      timestamp_ms: 120,
      tracking_lost: true,
      step: "EXTENSION",
      state_scores: {}
    },
    evidenceFrame(160, "GUARD"),
    evidenceFrame(200, "GUARD"),
    evidenceFrame(240, "GUARD")
  ];

  const decoded = decodeDurationAwareSequence(
    frames,
    jab,
    jab.getMode("practice").offline_decoder
  );

  assert.equal(decoded[3].tracking_lost, true);
  assert.equal(decoded[3].step, null);
  assert.equal(decoded[4].step, "GUARD");
});
