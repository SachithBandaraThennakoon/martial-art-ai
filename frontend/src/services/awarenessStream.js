import { WS_BASE_URL } from "./api.js";
import { getAccessToken, subscribeAccessToken } from "./authSession.js";

const AWARENESS_PUBLISH_INTERVAL_MS = 1000;

export function createAwarenessStream({
  endpoint = "/admin/awareness/stream",
  onSnapshotAck,
  onStatus
} = {}) {
  let socket = null;
  let disposed = false;
  let authenticated = false;
  let pendingMessage = null;
  let unsubscribeToken = null;
  let publishTimer = null;
  let reconnectTimer = null;
  let lastPublishAt = 0;
  let reconnectDelay = 500;

  const setStatus = (status) => onStatus?.(status);
  const sendPending = () => {
    if (!authenticated || !pendingMessage || socket?.readyState !== WebSocket.OPEN) return;
    const wait = Math.max(0, AWARENESS_PUBLISH_INTERVAL_MS - (Date.now() - lastPublishAt));
    if (wait > 0) {
      if (!publishTimer) {
        publishTimer = window.setTimeout(() => {
          publishTimer = null;
          sendPending();
        }, wait);
      }
      return;
    }
    socket.send(JSON.stringify(pendingMessage));
    pendingMessage = null;
    lastPublishAt = Date.now();
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(5000, reconnectDelay * 2);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || typeof WebSocket === "undefined" || socket) return;
    const token = getAccessToken();
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    setStatus("connecting");
    socket = new WebSocket(`${WS_BASE_URL}${endpoint}`);
    socket.onopen = () => {
      reconnectDelay = 500;
      socket?.send(JSON.stringify({ type: "authenticate", token }));
    };
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "authenticated") {
        authenticated = true;
        setStatus("live");
        sendPending();
      } else if (message.type === "snapshot_ack") {
        setStatus("live");
        onSnapshotAck?.(message);
      } else if (message.type === "error") {
        setStatus(message.code || "error");
      }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      authenticated = false;
      socket = null;
      if (!disposed) {
        setStatus("offline");
        scheduleReconnect();
      }
    };
  };

  unsubscribeToken = subscribeAccessToken((token) => {
    if (token && !socket && !disposed) connect();
  });
  connect();
  return {
    publish(snapshot) {
      pendingMessage = { type: "snapshot", payload: snapshot };
      sendPending();
    },
    publishPerception(perception) {
      pendingMessage = { type: "perception", payload: perception };
      sendPending();
    },
    close() {
      disposed = true;
      authenticated = false;
      unsubscribeToken?.();
      if (publishTimer) window.clearTimeout(publishTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    }
  };
}
