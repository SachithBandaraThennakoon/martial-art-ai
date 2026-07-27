import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import { TemporalStateMachine } from "../src/tracking/temporalStateMachine.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const techniqueRoot = path.resolve(testDirectory, "../../backend/data/techniques");

async function loadTechniquePackage(techniqueId) {
  const directory = path.join(techniqueRoot, techniqueId);
  const names = ["manifest", "states", "transitions", "errors", "modes", "cues"];
  const values = await Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(path.join(directory, `${name}.json`), "utf8"))
    )
  );
  return createTechniquePackage(
    Object.fromEntries(names.map((name, index) => [name, values[index]]))
  );
}

function feed(machine, timestamps, features, trackingConfidence = 0.96) {
  return timestamps.map((timestampMs) =>
    machine.update({ timestampMs, features, trackingConfidence })
  );
}

const JAB = {
  guard: {
    lead_elbow_angle: 90,
    lead_wrist_guard_distance: 0.2,
    motion_energy: 0.01
  },
  extension: {
    lead_elbow_angle: 125,
    lead_elbow_angular_velocity: 100,
    lead_wrist_forward_velocity: 0.5,
    motion_energy: 0.1
  },
  fullExtension: {
    lead_elbow_angle: 160,
    lead_wrist_forward_velocity: 0.02,
    motion_energy: 0.05
  },
  retraction: {
    lead_elbow_angle: 130,
    lead_elbow_angular_velocity: -100,
    lead_wrist_forward_velocity: -0.3,
    motion_energy: 0.08
  },
  recovery: {
    lead_elbow_angle: 95,
    lead_wrist_guard_distance: 0.22,
    motion_energy: 0.015
  }
};

test("Jab completes only after the configured ordered state sequence", async () => {
  const machine = new TemporalStateMachine(await loadTechniquePackage("jab"));

  assert.equal(feed(machine, [0, 40, 80, 120], JAB.guard).at(-1).state, "GUARD");
  assert.equal(
    feed(machine, [300, 360], JAB.extension).at(-1).state,
    "EXTENSION"
  );
  assert.equal(
    feed(machine, [430, 470], JAB.fullExtension).at(-1).state,
    "FULL_EXTENSION"
  );
  assert.equal(
    feed(machine, [540, 570, 600], JAB.retraction).at(-1).state,
    "RETRACTION"
  );
  assert.equal(
    feed(machine, [680, 720, 760, 800], JAB.recovery).at(-1).state,
    "RECOVERY"
  );
  const completed = feed(machine, [920, 960, 1000, 1040], JAB.guard).at(-1);

  assert.equal(completed.state, "GUARD");
  assert.equal(completed.event.repetition_completed, true);
  assert.equal(completed.phase, "ENTRY");
  assert.ok(completed.event.confidence >= 0.72);
});

test("one noisy Jab frame cannot change or advance the state", async () => {
  const machine = new TemporalStateMachine(await loadTechniquePackage("jab"));
  feed(machine, [0, 40, 80, 120], JAB.guard);

  const noise = feed(machine, [300], JAB.extension).at(-1);
  assert.equal(noise.state, "GUARD");
  assert.equal(noise.candidate_state, "EXTENSION");

  const recovered = feed(machine, [330], JAB.guard).at(-1);
  assert.equal(recovered.state, "GUARD");
  assert.equal(recovered.candidate_state, null);

  const insufficient = feed(machine, [400], JAB.extension).at(-1);
  assert.equal(insufficient.state, "GUARD");
  assert.equal(insufficient.candidate_frames, 1);

  const confirmed = feed(machine, [460], JAB.extension).at(-1);
  assert.equal(confirmed.state, "EXTENSION");
});

test("tracking loss clears a pending candidate without inventing a transition", async () => {
  const machine = new TemporalStateMachine(await loadTechniquePackage("jab"));
  feed(machine, [0, 40, 80, 120], JAB.guard);
  feed(machine, [300], JAB.extension);

  const lost = machine.update({
    timestampMs: 360,
    features: JAB.extension,
    trackingConfidence: 0.2
  });
  assert.equal(lost.tracking_lost, true);
  assert.equal(lost.state, "GUARD");
  assert.equal(lost.candidate_state, null);

  const afterRecovery = feed(machine, [400], JAB.extension).at(-1);
  assert.equal(afterRecovery.state, "GUARD");
  assert.equal(afterRecovery.candidate_frames, 1);
});

test("Jab guard hysteresis prevents borderline movement becoming unknown", async () => {
  const machine = new TemporalStateMachine(await loadTechniquePackage("jab"));
  feed(machine, [0, 40, 80, 120], JAB.guard);

  const borderline = machine.update({
    timestampMs: 300,
    features: {
      lead_elbow_angle: 90,
      lead_wrist_guard_distance: 0.39,
      motion_energy: 0.035
    },
    trackingConfidence: 0.96
  });

  assert.equal(borderline.state, "GUARD");
  assert.equal(borderline.within_hysteresis, true);
  assert.equal(borderline.unknown_movement, false);
});

test("a stalled Jab state times out and requests repetition abort", async () => {
  const machine = new TemporalStateMachine(await loadTechniquePackage("jab"));
  feed(machine, [0, 40, 80, 120], JAB.guard);
  feed(machine, [300, 360], JAB.extension);

  const timeout = machine.update({
    timestampMs: 1100,
    features: JAB.extension,
    trackingConfidence: 0.96
  });
  assert.equal(timeout.timed_out, true);
  assert.equal(timeout.state, null);
  assert.equal(timeout.event.type, "state_timeout");
  assert.equal(timeout.event.action, "ABORT_REPETITION");
});

const FRONT_KICK = {
  stance: {
    return_to_stance_distance: 0.05,
    support_leg_stability: 0.95,
    motion_energy: 0.01
  },
  chamber: {
    kick_knee_height: 0.5,
    kick_knee_angle: 70,
    support_leg_stability: 0.9,
    motion_energy: 0.08
  },
  extension: {
    kick_foot_forward_velocity: 0.6,
    kick_knee_angular_velocity: 100,
    kick_knee_angle: 155,
    motion_energy: 0.12
  },
  recoil: {
    kick_foot_forward_velocity: -0.3,
    kick_knee_angular_velocity: -90,
    kick_knee_angle: 90,
    motion_energy: 0.09
  },
  recovery: {
    return_to_stance_distance: 0.1,
    support_leg_stability: 0.9,
    motion_energy: 0.02
  }
};

test("Front Kick uses the same engine with its own ordered rules", async () => {
  const machine = new TemporalStateMachine(
    await loadTechniquePackage("front-kick")
  );

  assert.equal(
    feed(machine, [0, 40, 80, 120, 160], FRONT_KICK.stance).at(-1).state,
    "STANCE"
  );
  assert.equal(
    feed(machine, [360, 395, 430], FRONT_KICK.chamber).at(-1).state,
    "CHAMBER"
  );
  assert.equal(
    feed(machine, [530, 565, 600], FRONT_KICK.extension).at(-1).state,
    "EXTENSION"
  );
  assert.equal(
    feed(machine, [700, 735, 770], FRONT_KICK.recoil).at(-1).state,
    "RECOIL"
  );
  assert.equal(
    feed(machine, [910, 950, 990, 1030, 1070], FRONT_KICK.recovery).at(-1).state,
    "RECOVERY"
  );
  const completed = feed(
    machine,
    [1260, 1300, 1340, 1380, 1420],
    FRONT_KICK.stance
  ).at(-1);

  assert.equal(completed.state, "STANCE");
  assert.equal(completed.event.repetition_completed, true);
});
