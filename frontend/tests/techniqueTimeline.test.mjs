import assert from "node:assert/strict";
import test from "node:test";

import { buildTechniqueTimeline, timelineFrameAt } from "../src/utils/techniqueTimeline.js";

const steps = [
  { step_number: 1, transition_duration_ms: 650 },
  { step_number: 2, transition_duration_ms: 600 },
  { step_number: 3, transition_duration_ms: 500 },
  { step_number: 4, transition_duration_ms: 650 },
  { step_number: 5 },
];

test("combined timeline includes every transition and the configured cycle return", () => {
  const timeline = buildTechniqueTimeline(steps, {
    enabled: true,
    return_to_step_number: 1,
    transition_duration_ms: 350,
  });
  assert.equal(timeline.segments.length, 5);
  assert.equal(timeline.totalDurationMs, 2750);
  assert.deepEqual(
    timeline.segments.map(({ fromIndex, toIndex }) => [fromIndex, toIndex]),
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
  );
});

test("combined timeline resolves the active segment and local progress", () => {
  const timeline = buildTechniqueTimeline(steps);
  const frame = timelineFrameAt(timeline, 950);
  assert.equal(frame.fromIndex, 1);
  assert.equal(frame.toIndex, 2);
  assert.equal(frame.progress, 0.5);
});
