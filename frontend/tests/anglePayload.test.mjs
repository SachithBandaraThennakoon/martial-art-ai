import assert from "node:assert/strict";
import test from "node:test";

import { hasMeaningfulAngleChange } from "../src/utils/anglePayload.js";

test("emits when a tracked angle disappears", () => {
  assert.equal(
    hasMeaningfulAngleChange({ elbow_left: 166 }, {}),
    true
  );
});

test("ignores sub-degree jitter", () => {
  assert.equal(
    hasMeaningfulAngleChange({ elbow_left: 166 }, { elbow_left: 166.4 }),
    false
  );
});

test("emits when an angle becomes measurable", () => {
  assert.equal(
    hasMeaningfulAngleChange({}, { elbow_left: 166 }),
    true
  );
});
