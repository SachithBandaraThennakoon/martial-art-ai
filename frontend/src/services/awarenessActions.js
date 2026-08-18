export async function deliverAwarenessActions(actions = [], adapters = {}) {
  const results = [];
  for (const [index, action] of actions.entries()) {
    const started = performance.now();
    let status = "unsupported";
    try {
      if (action.channel === "visual" && adapters.visual) {
        await adapters.visual(action.payload);
        status = "delivered";
      } else if (action.channel === "audio" && adapters.audio) {
        await adapters.audio(action.payload);
        status = "delivered";
      } else if (action.channel === "system" && adapters.system) {
        await adapters.system(action.command, action.payload);
        status = "delivered";
      } else if (action.channel === "haptic" && adapters.haptic) {
        await adapters.haptic(action.payload);
        status = "delivered";
      } else if (action.channel === "haptic" && typeof navigator !== "undefined" && navigator.vibrate) {
        const pattern = action.payload?.pattern === "urgent_double" ? [120, 80, 120] : [100];
        status = navigator.vibrate(pattern) ? "delivered" : "rejected";
      }
    } catch {
      status = "failed";
    }
    results.push({
      action_id: action.action_id || `${action.channel || "unknown"}:${action.command || "unknown"}:${index}`,
      channel: action.channel,
      command: action.command,
      status,
      latency_ms: Math.max(0, performance.now() - started),
      detail: {},
    });
  }
  return results;
}
