import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverAwarenessActions,
  shouldAuditAwarenessDeliveries,
} from "../src/services/awarenessActions.js";

test("awareness action delivery acknowledges supported and unsupported channels", async () => {
  const shown = [];
  const results = await deliverAwarenessActions([
    { channel: "visual", command: "display_feedback", payload: { message: "Guard" } },
    { channel: "audio", command: "speak", payload: { message: "Guard" } },
  ], { visual: (payload) => shown.push(payload.message) });
  assert.deepEqual(shown, ["Guard"]);
  assert.equal(results[0].status, "delivered");
  assert.equal(results[1].status, "unsupported");
});

test("haptic safety action uses the urgent double vibration pattern", async () => {
  let received;
  const [result] = await deliverAwarenessActions([
    { channel: "haptic", command: "alert_pattern", payload: { pattern: "urgent_double" } }
  ], { haptic: (payload) => { received = payload.pattern; } });
  assert.equal(received, "urgent_double");
  assert.equal(result.status, "delivered");
});

test("delivery audit is limited to checkpoints, safety, and failures", () => {
  assert.equal(shouldAuditAwarenessDeliveries(
    { latency: { checkpointed: false }, backend_decision: { feedback: { type: "tracking" } } },
    [{ status: "delivered" }]
  ), false);
  assert.equal(shouldAuditAwarenessDeliveries(
    { latency: { checkpointed: true } },
    [{ status: "delivered" }]
  ), true);
  assert.equal(shouldAuditAwarenessDeliveries(
    { backend_decision: { feedback: { type: "safety" } } },
    [{ status: "delivered" }]
  ), true);
  assert.equal(shouldAuditAwarenessDeliveries({}, [{ status: "failed" }]), true);
});
