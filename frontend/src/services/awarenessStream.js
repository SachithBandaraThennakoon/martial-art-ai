import { WS_BASE_URL } from "./api.js";
import { getAccessToken, subscribeAccessToken } from "./authSession.js";

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

  const setStatus = (status) => onStatus?.(status);
  const sendPending = () => {
    if (!authenticated || !pendingMessage || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(pendingMessage));
    pendingMessage = null;
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
    socket.onopen = () => socket.send(JSON.stringify({ type: "authenticate", token }));
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
    socket.onerror = () => setStatus("offline");
    socket.onclose = () => {
      authenticated = false;
      socket = null;
      if (!disposed) setStatus("offline");
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
      socket?.close();
      socket = null;
    }
  };
}
