import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createTechniquePackage,
  TechniquePackageValidationError,
  validateTechniquePackage
} from "../src/tracking/techniquePackage.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const trackingRoot = path.resolve(
  testDirectory,
  "../../backend/data/techniques"
);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadTechniqueSource(techniqueId) {
  const directory = path.join(trackingRoot, techniqueId);
  const [manifest, states, transitions, errors, modes, cues] = await Promise.all(
    ["manifest", "states", "transitions", "errors", "modes", "cues"].map((name) =>
      readJson(path.join(directory, `${name}.json`))
    )
  );
  return { manifest, states, transitions, errors, modes, cues };
}

for (const techniqueId of ["jab", "front-kick"]) {
  test(`${techniqueId} tracking package is internally valid`, async () => {
    const source = await loadTechniqueSource(techniqueId);
    assert.equal(validateTechniquePackage(source), true);

    const techniquePackage = createTechniquePackage(source);
    assert.equal(techniquePackage.id, techniqueId);
    assert.equal(techniquePackage.getMode("train").live_corrections, true);
    assert.equal(techniquePackage.getMode("practice").post_session_correction, true);
  });
}

test("Jab only accepts its configured ordered transitions", async () => {
  const techniquePackage = createTechniquePackage(await loadTechniqueSource("jab"));

  assert.equal(techniquePackage.canTransition("GUARD", "EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("EXTENSION", "FULL_EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("GUARD", "FULL_EXTENSION"), false);
  assert.equal(techniquePackage.canTransition("FULL_EXTENSION", "RECOVERY"), false);
});

test("invalid technique packages return actionable validation issues", async () => {
  const source = await loadTechniqueSource("jab");
  source.transitions.transitions.EXTENSION.allowed = ["NOT_A_STATE"];

  assert.throws(
    () => validateTechniquePackage(source),
    (error) => {
      assert.ok(error instanceof TechniquePackageValidationError);
      assert.match(error.message, /unknown state/);
      return true;
    }
  );
});

test("offline decoder configuration rejects invalid duration values", async () => {
  const source = await loadTechniqueSource("jab");
  source.modes.practice.offline_decoder.unknown_min_duration_ms = -1;

  assert.throws(
    () => validateTechniquePackage(source),
    (error) => {
      assert.ok(error instanceof TechniquePackageValidationError);
      assert.match(error.message, /unknown_min_duration_ms must be non-negative/);
      return true;
    }
  );
});
