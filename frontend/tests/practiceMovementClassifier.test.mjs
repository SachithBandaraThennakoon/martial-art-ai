import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCountAttention,
  createPracticeMovementClassifier,
  filterPracticeTapeFrames,
  reclassifyPracticeSequence
} from "../src/utils/practiceMovementClassifier.js";

test("count time does not advance a movement repetition", () => {
  const classifier = createPracticeMovementClassifier({
    stepCount: 2,
    targetReps: 2
  });

  for (let index = 0; index < 20; index += 1) {
    classifier.update({ motionScore: 0, stepScores: [95, 10] });
  }

  assert.deepEqual(classifier.getState(), {
    rep: 1,
    expectedStep: 2,
    completed: false
  });
});

test("stable movement matches classify steps and complete the iteration", () => {
  const classifier = createPracticeMovementClassifier({
    stepCount: 2,
    targetReps: 2,
    stableFrames: 2,
    exitFrames: 2
  });

  classifier.update({ motionScore: 0.08, stepScores: [85, 20] });
  const firstStep = classifier.update({ motionScore: 0.01, stepScores: [88, 15] });
  assert.equal(firstStep.matchedStep, 1);
  assert.equal(firstStep.expectedStep, 2);
  assert.equal(firstStep.completedRep, null);

  classifier.update({ motionScore: 0.09, stepScores: [20, 86] });
  const transition = classifier.update({ motionScore: 0.08, stepScores: [15, 91] });
  assert.equal(transition.temporalPhase, "between_steps");
  classifier.update({ motionScore: 0.08, stepScores: [10, 94] });
  const finalStep = classifier.update({ motionScore: 0.01, stepScores: [10, 95] });
  assert.equal(finalStep.matchedStep, 2);
  assert.equal(finalStep.temporalPhase, "rep_peak");
  assert.equal(finalStep.completedRep, null);

  classifier.update({ motionScore: 0.05, stepScores: [90, 20] });
  const completed = classifier.update({ motionScore: 0.01, stepScores: [92, 15] });
  assert.equal(completed.temporalPhase, "rep_complete");
  assert.equal(completed.completedRep, 1);
  assert.equal(completed.expectedStep, 1);
  assert.equal(classifier.getState().rep, 2);
});

test("a held pose cannot complete a repetition until it is released", () => {
  const classifier = createPracticeMovementClassifier({
    stepCount: 1,
    targetReps: 2,
    stableFrames: 2,
    exitFrames: 2
  });

  classifier.update({ motionScore: 0.08, stepScores: [90] });
  const peak = classifier.update({ motionScore: 0, stepScores: [92] });
  assert.equal(peak.temporalPhase, "rep_peak");
  assert.equal(peak.completedRep, null);

  for (let index = 0; index < 10; index += 1) {
    classifier.update({ motionScore: 0, stepScores: [95] });
  }
  assert.equal(classifier.getState().rep, 1);

  classifier.update({ motionScore: 0.04, stepScores: [10] });
  const completed = classifier.update({ motionScore: 0.01, stepScores: [10] });
  assert.equal(completed.completedRep, 1);
  assert.equal(classifier.getState().rep, 2);
  assert.equal(classifier.getState().completed, false);
});

test("cue analysis adds timing metadata without replacing movement labels", () => {
  const frames = [
    { elapsedMs: 100, rep: 1, step: 1, motionScore: 0.1 },
    { elapsedMs: 300, rep: 1, step: 2, motionScore: 0.8 },
    { elapsedMs: 1200, rep: 2, step: 1, motionScore: 0.9 }
  ];
  const analyzed = attachCountAttention(
    frames,
    [{ elapsedMs: 0 }, { elapsedMs: 1000 }],
    1000
  );

  assert.deepEqual(
    analyzed.map(({ rep, step }) => ({ rep, step })),
    frames.map(({ rep, step }) => ({ rep, step }))
  );
  assert.deepEqual(analyzed.map((frame) => frame.countCue), [1, 1, 2]);
});

test("rep and step filters return only the exact movement frame range", () => {
  const frames = [
    { frame: 1, rep: 2, step: 2 },
    { frame: 2, rep: 3, step: 1 },
    { frame: 3, rep: 3, step: 2 },
    { frame: 4, rep: 3, step: 2 },
    { frame: 5, rep: 4, step: 2 }
  ];

  const filtered = filterPracticeTapeFrames(frames, { rep: "3", step: "2" });

  assert.deepEqual(
    filtered.map(({ frame, index }) => ({ number: frame.frame, index })),
    [
      { number: 3, index: 2 },
      { number: 4, index: 3 }
    ]
  );
});

test("jab counts on extension and requires recovery before the next repetition", () => {
  const classifier = createPracticeMovementClassifier({
    countStep: 2,
    stepCount: 3,
    targetReps: 2,
    stableFrames: 2,
    exitFrames: 2,
    recoveryFrames: 2
  });

  classifier.update({ motionScore: 0, stepScores: [92, 15, 20] });
  const guard = classifier.update({ motionScore: 0, stepScores: [94, 12, 18] });
  assert.equal(guard.matchedStep, 1);
  assert.equal(guard.countedRep, null);

  classifier.update({ motionScore: 0.08, stepScores: [35, 45, 20] });
  classifier.update({ motionScore: 0.08, stepScores: [25, 50, 20] });
  const transition = classifier.update({ motionScore: 0.1, stepScores: [20, 82, 20] });
  assert.equal(transition.temporalPhase, "between_steps");

  const impactCandidate = classifier.update({
    motionScore: 0.09,
    stepScores: [16, 96, 18]
  });
  assert.equal(impactCandidate.matchedStep, null);
  assert.equal(impactCandidate.temporalPhase, "step_peak");
  assert.equal(impactCandidate.scorable, true);

  const impact = classifier.update({
    motionScore: 0.09,
    stepScores: [55, 40, 72]
  });
  assert.equal(impact.matchedStep, 2);
  assert.equal(impact.matchKind, "impact-peak");
  assert.equal(impact.phase, "transition");
  assert.equal(impact.scorable, false);
  assert.equal(impact.countedRep, 1);
  assert.equal(impact.completedRep, null);
  assert.equal(impact.expectedStep, 3);

  classifier.update({ motionScore: 0.02, stepScores: [86, 15, 92] });
  const recoveryPose = classifier.update({
    motionScore: 0.01,
    stepScores: [90, 12, 94]
  });
  assert.equal(recoveryPose.matchedStep, 3);
  assert.equal(recoveryPose.temporalPhase, "rep_peak");
  assert.equal(recoveryPose.completedRep, null);
  classifier.update({ motionScore: 0.01, stepScores: [90, 12, 94] });
  const recovered = classifier.update({ motionScore: 0.01, stepScores: [90, 12, 94] });
  assert.equal(recovered.completedRep, 1);
  assert.equal(recovered.temporalPhase, "rep_complete");
  assert.equal(recovered.expectedStep, 1);
  assert.equal(classifier.getState().rep, 2);
});

test("a fast punch can count from one sampled impact frame", () => {
  const classifier = createPracticeMovementClassifier({
    countStep: 2,
    stepCount: 3,
    targetReps: 2,
    stableFrames: 3,
    exitFrames: 2
  });

  classifier.update({ motionScore: 0, stepScores: [92, 10, 20] });
  classifier.update({ motionScore: 0, stepScores: [94, 12, 18] });
  classifier.update({ motionScore: 0, stepScores: [95, 11, 17] });
  classifier.update({ motionScore: 0.05, stepScores: [30, 45, 20] });
  classifier.update({ motionScore: 0.06, stepScores: [25, 55, 20] });
  classifier.update({ motionScore: 0.07, stepScores: [20, 60, 20] });

  const sampledImpact = classifier.update({
    motionScore: 0.12,
    stepScores: [30, 66, 20]
  });
  assert.equal(sampledImpact.matchedStep, null);
  assert.equal(sampledImpact.phase, "keyframe");

  const impact = classifier.update({
    motionScore: 0.11,
    stepScores: [60, 32, 68]
  });
  assert.equal(impact.countedRep, 1);
  assert.equal(impact.matchedStep, 2);
  assert.equal(impact.matchKind, "impact-peak");
  assert.equal(impact.expectedStep, 3);
});

test("impact candidates stay on the strike step until the extension arc exits", () => {
  const classifier = createPracticeMovementClassifier({
    countStep: 2,
    stepCount: 3,
    targetReps: 2,
    stableFrames: 2,
    exitFrames: 2
  });

  classifier.update({ motionScore: 0, stepScores: [94, 10, 18] });
  classifier.update({ motionScore: 0, stepScores: [95, 10, 17] });
  classifier.update({ motionScore: 0.05, stepScores: [35, 45, 20] });
  classifier.update({ motionScore: 0.06, stepScores: [25, 55, 20] });
  classifier.update({ motionScore: 0.07, stepScores: [20, 70, 20] });

  const earlyExtension = classifier.update({
    motionScore: 0.08,
    stepScores: [30, 82, 20]
  });
  const fullExtension = classifier.update({
    motionScore: 0.1,
    stepScores: [16, 96, 18]
  });

  assert.equal(earlyExtension.expectedStep, 2);
  assert.equal(fullExtension.expectedStep, 2);
  assert.equal(earlyExtension.countedRep, null);
  assert.equal(fullExtension.countedRep, null);

  const leavingExtension = classifier.update({
    motionScore: 0.09,
    stepScores: [55, 40, 72]
  });
  assert.equal(leavingExtension.countedRep, 1);
  assert.equal(leavingExtension.expectedStep, 3);
});

test("low-confidence and one-frame noisy poses do not advance the sequence", () => {
  const classifier = createPracticeMovementClassifier({
    stepCount: 2,
    targetReps: 1,
    stableFrames: 3
  });

  const trackingLost = classifier.update({
    motionScore: 0.1,
    stepScores: [96, 10],
    trackingConfidence: 0.3
  });
  assert.equal(trackingLost.temporalPhase, "tracking_lost");
  assert.equal(trackingLost.trackingReliable, false);

  const noisyMatch = classifier.update({
    motionScore: 0.1,
    stepScores: [95, 10],
    trackingConfidence: 0.9
  });
  classifier.update({
    motionScore: 0.1,
    stepScores: [20, 25],
    trackingConfidence: 0.9
  });

  assert.equal(noisyMatch.matchedStep, null);
  assert.equal(classifier.getState().expectedStep, 1);
});

test("fast motion does not count when the impact step is not the best match", () => {
  const classifier = createPracticeMovementClassifier({
    countStep: 2,
    stepCount: 3,
    targetReps: 2,
    stableFrames: 2
  });

  classifier.update({ motionScore: 0, stepScores: [95, 10, 15] });
  classifier.update({ motionScore: 0, stepScores: [96, 10, 14] });
  const wrongMotion = classifier.update({
    motionScore: 0.15,
    stepScores: [82, 64, 20]
  });

  assert.equal(wrongMotion.countedRep, null);
  assert.equal(wrongMotion.matchedStep, null);
  assert.equal(wrongMotion.expectedStep, 2);
});

test("specific step filters exclude connecting transition frames", () => {
  const frames = [
    { frame: 1, rep: 1, step: 2, phase: "transition", scorable: false },
    { frame: 2, rep: 1, step: 2, phase: "keyframe", scorable: true },
    { frame: 3, rep: 1, step: 3, phase: "transition", scorable: false }
  ];

  const filtered = filterPracticeTapeFrames(frames, {
    rep: "1",
    step: "2"
  });

  assert.deepEqual(filtered.map(({ frame }) => frame.frame), [2]);
});

test("post-session pass rebuilds ordered step and repetition labels", () => {
  const evidence = [
    [0.08, [85, 20]],
    [0.01, [88, 15]],
    [0.09, [20, 86]],
    [0.08, [15, 91]],
    [0.08, [10, 94]],
    [0.01, [10, 95]],
    [0.05, [90, 20]],
    [0.01, [92, 15]]
  ];
  const frames = evidence.map(([motionScore, stepScores], index) => ({
    frame: index + 1,
    sourceTimestampMs: 1000 + index * (1000 / 30),
    rep: 9,
    step: 9,
    phase: "transition",
    temporalPhase: "wrong_live_label",
    motionScore,
    stepScores,
    trackingConfidence: 0.95
  }));

  const result = reclassifyPracticeSequence(frames, {
    stepCount: 2,
    targetReps: 1,
    stableFrames: 2,
    exitFrames: 2,
    evidenceRadius: 0
  });

  assert.equal(result[1].step, 1);
  assert.equal(result[1].temporalPhase, "step_hold");
  assert.equal(result[5].temporalPhase, "rep_peak");
  assert.equal(result.at(-1).temporalPhase, "session_complete");
  assert.equal(result.at(-1).postSessionClassified, true);
  assert.equal(result.at(-1).liveRep, 9);
  assert.equal(result.at(-1).liveTemporalPhase, "wrong_live_label");
});
