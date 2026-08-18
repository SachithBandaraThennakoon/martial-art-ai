import assert from "node:assert/strict";
import test from "node:test";

import { buildAwarenessPerceptionEnvelope } from "../src/perception/awarenessEnvelope.js";

test("builds the same strict perception envelope for user and admin orchestrators", () => {
  const envelope = buildAwarenessPerceptionEnvelope({
    diagnostics: {
      level1State: {
        tracking: { confidence: 1.4, fps: 8 },
        motion_context: { angles_deg: { elbow_left: 90 }, motion_energy: 0.3 }
      },
      level2State: { action_context: { step_id: "guard", mistake_risk: 0.6 } },
      level3State: { session_context: { repetitions: 2 } },
      level4State: { user_context: { skill: 0.4 } },
      situationAwarenessState: {
        situation_context: {
          situation_state: "correcting",
          feedback_decision: { message: "Raise guard." },
          next_action: { command: "hold_current_step" }
        }
      },
      perceptionObservation: {
        human: { bbox: [0.1, 0.2, 0.8, 0.9] },
        surfaces: [{ surface_id: "floor:primary" }],
        geometry: { confidence: 0.8 }
      }
    },
    sequence: 3,
    sessionKey: "user.jab.run",
    techniqueName: "Jab",
    metadata: { source: "studio-train-mode" }
  });

  assert.equal(envelope.schema_version, "perception/v1");
  assert.equal(envelope.human.confidence, 1);
  assert.equal(envelope.human.l2.step_id, "guard");
  assert.equal(envelope.surfaces[0].surface_id, "floor:primary");
  assert.equal(envelope.metadata.source, "studio-train-mode");
  assert.equal(envelope.metadata.client_awareness.next_action.command, "hold_current_step");
  assert.equal("frame" in envelope, false);
});
