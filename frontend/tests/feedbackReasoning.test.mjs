import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeSetMessage,
  getCoachFeedbackIntent,
  getPracticeFeedbackIntent,
  repeatsPendingQuestion
} from "../src/services/feedbackReasoning.js";

test("ready-check paraphrases share one semantic intent", () => {
  const greeting = {
    message: "Hello. Are you ready to begin?",
    requires_response: true,
    question: { kind: "ready" }
  };
  const shorterPrompt = {
    message: "Are you ready to begin?",
    requires_response: true,
    question: { kind: "ready" }
  };

  const intent = getCoachFeedbackIntent(greeting);
  assert.equal(intent, "question:ready");
  assert.equal(getCoachFeedbackIntent(shorterPrompt), intent);
  assert.equal(repeatsPendingQuestion(shorterPrompt, intent), true);
});

test("a reminder is distinct from the original ready check", () => {
  const reminder = {
    feedback_intent: "question:ready:reminder",
    requires_response: true,
    question: { kind: "ready" }
  };

  assert.equal(repeatsPendingQuestion(reminder, "question:ready"), false);
});

test("practice setup paraphrases are deduplicated but set start is new", () => {
  assert.equal(
    getPracticeFeedbackIntent("Welcome. Set your reps, then start when ready."),
    "setup_ready"
  );
  assert.equal(
    getPracticeFeedbackIntent("Still with me? Choose your reps, then say start when ready."),
    "setup_ready"
  );
  assert.equal(
    getPracticeFeedbackIntent("I will count completed reps. Follow each step."),
    "set_start"
  );
});

test("practice count choices remain distinct reasoning events", () => {
  assert.equal(getPracticeFeedbackIntent("Count set to 3. Say start when ready."), "count_selected:3");
  assert.equal(getPracticeFeedbackIntent("Count set to 5. Say start when ready."), "count_selected:5");
  assert.equal(getPracticeFeedbackIntent("This set is active. Reset before changing it."), "set_active");
});

test("practice set feedback reasons from the chosen count, gap, and step", () => {
  assert.equal(
    buildPracticeSetMessage({ gapMs: 1500, reps: 3 }),
    "3 reps selected. I will count every 1.5 seconds. Press Start set when ready."
  );
  assert.equal(
    buildPracticeSetMessage({
      gapMs: 1500,
      reps: 3,
      started: true,
      stepName: "Hands up shoulders"
    }),
    "Set started: 3 reps, counting every 1.5 seconds. Begin Hands up shoulders. I will lead the rhythm and score your movement separately."
  );
});
