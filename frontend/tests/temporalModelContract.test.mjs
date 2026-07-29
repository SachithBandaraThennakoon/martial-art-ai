import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blendTemporalStateEvidence,
  logitsToStateProbabilities,
  validateTemporalModelMetadata,
  validateUniversalTemporalMetadata
} from "../src/tracking/temporalModelContract.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("temporal model metadata must cover every decoder state", () => {
  const result = validateTemporalModelMetadata(
    {
      model_type: "temporal-state-emission",
      input: { layout: "BTVC", joints: 33 },
      output: { labels: ["__UNKNOWN__", "GUARD", "EXTENSION"] }
    },
    { stateNames: ["GUARD", "EXTENSION", "RECOVERY"] }
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /RECOVERY/);
});

test("universal metadata covers the selected technique and native states", () => {
  const result = validateUniversalTemporalMetadata(
    {
      model_type: "universal-temporal-phase",
      inputs: {
        landmarks: { layout: "BTVC", joints: 33 },
        technique: { labels: ["jab", "front-kick"] }
      },
      output: {
        labels: ["__UNKNOWN__", "PREPARATION", "PEAK", "RECOVERY"]
      },
      techniques: {
        jab: {
          phase_to_native: {
            PREPARATION: "GUARD",
            PEAK: "FULL_EXTENSION",
            RECOVERY: "RECOVERY"
          }
        }
      }
    },
    { id: "jab", stateNames: ["GUARD", "FULL_EXTENSION", "RECOVERY"] }
  );
  assert.equal(result.valid, true);
  assert.equal(result.techniqueIndex, 0);
});

test("deployed universal model metadata covers Jab and Front Kick", async () => {
  const metadata = JSON.parse(
    await readFile(
      path.resolve(
        testDirectory,
        "../public/models/universal-temporal/martial_arts_temporal.metadata.json"
      ),
      "utf8"
    )
  );
  for (const techniqueId of ["jab", "front-kick"]) {
    const techniqueDirectory = path.resolve(
      testDirectory,
      `../../backend/data/techniques/${techniqueId}`
    );
    const trainingSteps = JSON.parse(
      await readFile(path.join(techniqueDirectory, "training-steps.json"), "utf8")
    );
    const states = trainingSteps.temporal_runtime?.states || JSON.parse(
      await readFile(path.join(techniqueDirectory, "states.json"), "utf8")
    );
    const result = validateUniversalTemporalMetadata(metadata, {
      id: techniqueId,
      stateNames: states.state_order
    });
    assert.equal(result.valid, true, result.errors.join("; "));
  }
});

test("standalone Colab metadata is normalized to the runtime contract", () => {
  const result = validateTemporalModelMetadata(
    {
      sequence_length: 90,
      input_channels: ["x", "y", "z", "visibility"],
      state_names: [
        "__UNKNOWN__",
        "GUARD",
        "EXTENSION",
        "FULL_EXTENSION",
        "RETRACTION",
        "RECOVERY"
      ],
      output: "per_frame_state_logits"
    },
    {
      stateNames: [
        "GUARD",
        "EXTENSION",
        "FULL_EXTENSION",
        "RETRACTION",
        "RECOVERY"
      ]
    }
  );
  assert.equal(result.valid, true);
});

test("learned state logits become normalized probabilities", () => {
  const probabilities = logitsToStateProbabilities(
    [0, 2, 1],
    ["GUARD", "EXTENSION", "RECOVERY"]
  );
  const total = Object.values(probabilities).reduce(
    (sum, value) => sum + value,
    0
  );
  assert.ok(Math.abs(total - 1) < 1e-8);
  assert.ok(probabilities.EXTENSION > probabilities.RECOVERY);
});

test("low-confidence learned evidence cannot override rules", () => {
  const result = blendTemporalStateEvidence(
    { GUARD: 0.9, EXTENSION: 0.1 },
    { GUARD: 0.4, EXTENSION: 0.35 },
    { learnedWeight: 0.8, minimumLearnedConfidence: 0.5 }
  );
  assert.equal(result.GUARD, 0.9);
  assert.equal(result.EXTENSION, 0.1);
});
