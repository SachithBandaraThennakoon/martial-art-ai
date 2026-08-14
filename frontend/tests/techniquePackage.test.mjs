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
import { loadTechniqueSource } from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const trackingRoot = path.resolve(
  testDirectory,
  "../../backend/data/techniques"
);

for (const techniqueId of ["jab", "front-kick"]) {
  test(`${techniqueId} tracking package is internally valid`, async () => {
    const source = await loadTechniqueSource(trackingRoot, techniqueId);
    assert.equal(validateTechniquePackage(source), true);

    const techniquePackage = createTechniquePackage(source);
    assert.equal(techniquePackage.id, techniqueId);
    assert.equal(techniquePackage.getMode("train").live_corrections, true);
    assert.equal(techniquePackage.getMode("practice").post_session_correction, true);
  });
}

test("Jab only accepts its configured ordered transitions", async () => {
  const techniquePackage = createTechniquePackage(
    await loadTechniqueSource(trackingRoot, "jab")
  );

  assert.equal(techniquePackage.canTransition("GUARD", "EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("EXTENSION", "FULL_EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("GUARD", "FULL_EXTENSION"), false);
  assert.equal(techniquePackage.canTransition("FULL_EXTENSION", "RECOVERY"), false);
});

test("invalid technique packages return actionable validation issues", async () => {
  const source = await loadTechniqueSource(trackingRoot, "jab");
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
  const source = await loadTechniqueSource(trackingRoot, "jab");
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

test("every Jab angle target has a valid ideal inside its range", async () => {
  const document = JSON.parse(
    await readFile(
      path.join(trackingRoot, "jab", "training-steps.json"),
      "utf8"
    )
  );

  const expectedPoseAngles = [
    "ankle_left",
    "ankle_right",
    "elbow_left",
    "elbow_right",
    "hip_left",
    "hip_right",
    "knee_left",
    "knee_right",
    "shoulder_left",
    "shoulder_right",
  ];

  for (const step of document.steps) {
    assert.deepEqual(
      step.angle_targets.map((target) => target.body_part).sort(),
      expectedPoseAngles,
    );
    for (const target of step.angle_targets) {
      assert.ok(
        target.target_angle >= target.min &&
          target.target_angle <= target.max,
        `${step.step_name}: ${target.body_part} target must be inside its range`
      );
    }
  }
});

test("Jab authoring poses include safe impact and complete transition data", async () => {
  const document = JSON.parse(
    await readFile(
      path.join(trackingRoot, "jab", "training-steps.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    document.steps.map(
      (step) => step.reference_pose.articulation.hand_left.palm_turn,
    ),
    [0, 1, 0],
    "lead fist should turn palm-down only at impact",
  );
  assert.deepEqual(
    document.steps.slice(0, -1).map((step) => step.transition_duration_ms),
    [550, 650],
  );
  for (const step of document.steps) {
    assert.ok(step.reference_pose.tolerance <= 0.12);
    for (const side of ["hand_left", "hand_right"]) {
      const hand = step.reference_pose.articulation[side];
      assert.equal(hand.fist_closure, 1);
      assert.ok(hand.palm_turn >= 0 && hand.palm_turn <= 1);
      assert.equal(hand.wrist_rotation.length, 3);
    }
  }
  const impactElbow = document.steps[1].angle_targets.find(
    (target) => target.body_part === "elbow_left",
  );
  assert.equal(impactElbow.role, "primary");
  assert.ok(impactElbow.target_angle <= 175, "impact elbow must not lock");
});

test("Front Kick authoring data includes the complete guard-to-recovery cycle", async () => {
  const document = JSON.parse(
    await readFile(
      path.join(trackingRoot, "front-kick", "training-steps.json"),
      "utf8",
    ),
  );
  assert.equal(document.schema_version, "2.0");
  assert.deepEqual(
    document.steps.map((step) => step.phase_states),
    [["STANCE"], ["CHAMBER"], ["EXTENSION"], ["RECOIL"], ["RECOVERY"]],
  );
  assert.deepEqual(
    document.steps.slice(0, -1).map((step) => step.transition_duration_ms),
    [650, 600, 500, 650],
  );
  assert.deepEqual(
    document.cycle,
    {
      enabled: true,
      return_to_step_number: 1,
      transition_duration_ms: 350,
      description: "Continue from the recovered guard into the next repetition.",
    },
  );
  for (const step of document.steps) {
    assert.equal(step.angle_targets.length, 10);
    assert.ok(step.reference_pose?.landmarks);
    assert.ok(step.reference_pose.tolerance <= 0.12);
    assert.equal(step.reference_pose.articulation.hand_left.fist_closure, 1);
    assert.equal(step.reference_pose.articulation.hand_right.fist_closure, 1);
    for (const target of step.angle_targets) {
      assert.ok(target.target_angle >= target.min && target.target_angle <= target.max);
    }
  }
  assert.deepEqual(
    document.steps[0].reference_pose.landmarks,
    JSON.parse(
      await readFile(path.join(trackingRoot, "jab", "training-steps.json"), "utf8"),
    ).steps[0].reference_pose.landmarks,
    "Front Kick should reuse the proven Jab guard skeleton",
  );
  assert.deepEqual(
    document.steps[3].reference_pose,
    document.steps[1].reference_pose,
    "Recoil should return through the authored chamber pose",
  );
  assert.deepEqual(
    document.steps[4].reference_pose,
    document.steps[0].reference_pose,
    "Recovery should visibly finish in the authored guard pose",
  );
  const chamberKnee = document.steps[1].angle_targets.find(
    (target) => target.body_part === "knee_right",
  );
  const extensionKnee = document.steps[2].angle_targets.find(
    (target) => target.body_part === "knee_right",
  );
  assert.equal(document.steps[2].striking_surface, "ball_of_foot");
  assert.equal(document.steps[2].striking_side, "right");
  assert.equal(chamberKnee.role, "primary");
  assert.ok(chamberKnee.target_angle < 100);
  assert.equal(extensionKnee.role, "primary");
  assert.ok(extensionKnee.target_angle >= 145 && extensionKnee.target_angle < 178);
  assert.ok(
    document.temporal_runtime.errors.errors.some(
      (error) => error.id === "excessive_knee_extension" && error.severity === "safety",
    ),
  );
});
