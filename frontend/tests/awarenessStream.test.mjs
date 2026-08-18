import assert from "node:assert/strict";
import test from "node:test";

import { createAwarenessStream } from "../src/services/awarenessStream.js";
import { setAccessToken } from "../src/services/authSession.js";


class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
}


test.beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  setAccessToken("admin-access");
});

test.afterEach(() => {
  setAccessToken(null);
  delete globalThis.WebSocket;
});

test("awareness stream authenticates before publishing the latest queued snapshot", () => {
  const stream = createAwarenessStream();
  const socket = FakeWebSocket.instances[0];
  stream.publish({ session_key: "first", sequence: 1 });
  stream.publish({ session_key: "latest", sequence: 2 });
  socket.open();
  assert.deepEqual(socket.sent[0], { type: "authenticate", token: "admin-access" });
  socket.receive({ type: "authenticated" });
  assert.deepEqual(socket.sent[1], {
    type: "snapshot", payload: { session_key: "latest", sequence: 2 }
  });
  stream.close();
});

test("awareness stream exposes acknowledgements and operational status", () => {
  const statuses = [];
  const acknowledgements = [];
  const stream = createAwarenessStream({
    onStatus: (status) => statuses.push(status),
    onSnapshotAck: (ack) => acknowledgements.push(ack),
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "authenticated" });
  socket.receive({ type: "snapshot_ack", latency: { processing_ms: 12, within_budget: true } });
  assert.ok(statuses.includes("connecting"));
  assert.ok(statuses.includes("live"));
  assert.equal(acknowledgements[0].latency.processing_ms, 12);
  stream.close();
});

test("awareness stream publishes a fused perception envelope", () => {
  const stream = createAwarenessStream({ endpoint: "/awareness/stream" });
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "ws://localhost:8000/awareness/stream");
  socket.open();
  socket.receive({ type: "authenticated" });
  stream.publishPerception({ session_key: "scene", sequence: 4, surfaces: [] });
  assert.deepEqual(socket.sent[1], {
    type: "perception",
    payload: { session_key: "scene", sequence: 4, surfaces: [] },
  });
  stream.close();
});
