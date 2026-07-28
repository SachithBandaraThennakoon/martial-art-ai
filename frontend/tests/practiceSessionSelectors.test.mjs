import assert from "node:assert/strict";
import test from "node:test";

import {
  selectLatestPracticeSession,
  sortPracticeSessions
} from "../src/utils/practiceSessionSelectors.js";

const sessions = [
  {
    id: 60,
    status: "completed",
    ended_at: "2026-07-28T12:10:11+05:30"
  },
  {
    id: 63,
    status: "cancelled",
    ended_at: "2026-07-28T15:10:08+05:30"
  },
  {
    id: 62,
    status: "cancelled",
    ended_at: "2026-07-28T14:46:59+05:30"
  }
];

test("latest Practice session does not skip a newer recorded tape", () => {
  assert.equal(selectLatestPracticeSession(sessions)?.id, 63);
});

test("Practice history sorting is stable in both directions", () => {
  assert.deepEqual(
    sortPracticeSessions(sessions, "desc").map((session) => session.id),
    [63, 62, 60]
  );
  assert.deepEqual(
    sortPracticeSessions(sessions, "asc").map((session) => session.id),
    [60, 62, 63]
  );
});
