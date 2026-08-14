export function normalizedTransitionDuration(value, fallback = 1600) {
  return Math.max(200, Math.min(10000, Number(value) || fallback));
}

export function buildTechniqueTimeline(steps = [], cycle = null) {
  const segments = [];
  let startMs = 0;
  for (let index = 0; index < steps.length - 1; index += 1) {
    const durationMs = normalizedTransitionDuration(
      steps[index]?.transition_duration_ms,
    );
    segments.push({
      fromIndex: index,
      toIndex: index + 1,
      startMs,
      durationMs,
      endMs: startMs + durationMs,
      isCycleReturn: false,
    });
    startMs += durationMs;
  }
  if (cycle?.enabled && steps.length > 1) {
    const toIndex = Math.max(
      0,
      Math.min(steps.length - 1, Number(cycle.return_to_step_number || 1) - 1),
    );
    const durationMs = normalizedTransitionDuration(
      cycle.transition_duration_ms,
      900,
    );
    segments.push({
      fromIndex: steps.length - 1,
      toIndex,
      startMs,
      durationMs,
      endMs: startMs + durationMs,
      isCycleReturn: true,
    });
    startMs += durationMs;
  }
  return { segments, totalDurationMs: startMs };
}

export function timelineFrameAt(timeline, rawTimeMs) {
  const total = timeline?.totalDurationMs || 0;
  const timeMs = Math.max(0, Math.min(total, Number(rawTimeMs) || 0));
  const segments = timeline?.segments || [];
  if (!segments.length) return null;
  const segment = segments.find((item) => timeMs < item.endMs) || segments.at(-1);
  const progress = segment.durationMs
    ? Math.max(0, Math.min(1, (timeMs - segment.startMs) / segment.durationMs))
    : 0;
  return { ...segment, progress, timeMs };
}
