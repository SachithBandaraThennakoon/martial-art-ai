import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeSessionAnalysis,
  buildPracticeSessionMetrics,
  selectPracticeTimelineView
} from "../src/utils/practiceSessionAnalysis.js";

const frame = ({
  elapsedMs,
  rep = 1,
  step = 1,
  temporalPhase,
  completedRep = null,
  matchedStep = null,
  stepScores = [],
  accuracy = null,
  scorable = false,
  rule = null
}) => ({
  elapsedMs,
  rep,
  step,
  temporalPhase,
  completedRep,
  matchedStep,
  stepScores,
  accuracy,
  scorable,
  trackingReliable: true,
  ruleEngineAnalysis: rule ? { corrected: rule } : null
});

test("session analysis separates preparation from ordered repetitions", () => {
  const analysis = buildPracticeSessionAnalysis([
    frame({
      elapsedMs: 0,
      temporalPhase: "waiting_for_movement",
      rule: { rep_id: null, rep_state: "WAITING" }
    }),
    frame({ elapsedMs: 100, temporalPhase: "step_enter", scorable: true, accuracy: 90 }),
    frame({ elapsedMs: 200, step: 2, temporalPhase: "step_peak", scorable: true, accuracy: 85 }),
    frame({ elapsedMs: 300, step: 3, temporalPhase: "rep_peak", scorable: true, accuracy: 88 }),
    frame({ elapsedMs: 400, step: 3, temporalPhase: "session_complete", completedRep: 1 })
  ], {
    steps: [
      { step_name: "Guard" },
      { step_name: "Extension" },
      { step_name: "Recovery" }
    ],
    targetReps: 1,
    strictSummary: { completed_repetitions: 0, aborted_repetitions: 1 }
  });

  assert.equal(analysis.segments[0].kind, "preparation");
  assert.equal(analysis.repetitions.length, 1);
  assert.equal(analysis.repetitions[0].status, "completed");
  assert.deepEqual(analysis.repetitions[0].detected_steps, [1, 2, 3]);
  assert.equal(analysis.clustered_completed_repetitions, 1);
  assert.equal(analysis.strict_verified_repetitions, 0);
});

test("session analysis keeps an unfinished sequence incomplete", () => {
  const analysis = buildPracticeSessionAnalysis([
    frame({ elapsedMs: 0, temporalPhase: "step_enter", scorable: true, accuracy: 90 }),
    frame({ elapsedMs: 100, step: 2, temporalPhase: "step_peak", scorable: true, accuracy: 72 }),
    frame({ elapsedMs: 200, step: 3, temporalPhase: "seeking_step" })
  ], {
    steps: [{}, {}, {}],
    targetReps: 1
  });

  assert.equal(analysis.clustered_completed_repetitions, 0);
  assert.equal(analysis.clustered_incomplete_repetitions, 1);
  assert.equal(analysis.repetitions[0].step_coverage_percentage, 67);
});

test("completion evidence with a missing opening step is marked as a partial tape", () => {
  const analysis = buildPracticeSessionAnalysis([
    frame({ elapsedMs: 0, step: 2, temporalPhase: "step_peak", accuracy: 85, scorable: true }),
    frame({ elapsedMs: 100, step: 3, temporalPhase: "rep_peak", accuracy: 90, scorable: true }),
    frame({ elapsedMs: 200, step: 3, temporalPhase: "rep_complete", completedRep: 1 })
  ], {
    steps: [{}, {}, {}],
    targetReps: 1
  });

  assert.equal(analysis.repetitions[0].status, "partial");
  assert.equal(analysis.repetitions[0].step_coverage_percentage, 67);
  assert.equal(analysis.clustered_completed_repetitions, 0);
});

test("trailing seeking frames do not create a phantom repetition", () => {
  const analysis = buildPracticeSessionAnalysis([
    frame({ elapsedMs: 0, rep: 1, step: 1, temporalPhase: "step_hold", matchedStep: 1 }),
    frame({ elapsedMs: 100, rep: 1, step: 2, temporalPhase: "step_peak", matchedStep: 2 }),
    frame({ elapsedMs: 200, rep: 1, step: 3, temporalPhase: "rep_peak", matchedStep: 3 }),
    frame({ elapsedMs: 300, rep: 1, step: 3, temporalPhase: "rep_complete", completedRep: 1 }),
    frame({ elapsedMs: 400, rep: 2, step: 1, temporalPhase: "seeking_step" }),
    frame({ elapsedMs: 500, rep: 2, step: 1, temporalPhase: "seeking_step" })
  ], {
    steps: [{}, {}, {}],
    targetReps: 2
  });

  assert.equal(analysis.repetitions.length, 1);
  assert.equal(analysis.clustered_completed_repetitions, 1);
  assert.equal(analysis.segments.at(-1).kind, "preparation");
});

test("repetition windows follow movement and keep unequal durations", () => {
  const analysis = buildPracticeSessionAnalysis([
    frame({ elapsedMs: 0, rep: 1, step: 1, temporalPhase: "waiting_for_movement" }),
    frame({ elapsedMs: 1000, rep: 1, step: 1, temporalPhase: "step_exit" }),
    frame({ elapsedMs: 4200, rep: 1, step: 1, temporalPhase: "step_exit" }),
    frame({ elapsedMs: 5000, rep: 1, step: 2, temporalPhase: "step_peak", matchedStep: 2 }),
    frame({ elapsedMs: 5400, rep: 1, step: 3, temporalPhase: "rep_peak", matchedStep: 3 }),
    frame({ elapsedMs: 6000, rep: 1, step: 3, temporalPhase: "rep_complete", completedRep: 1 }),
    frame({ elapsedMs: 7000, rep: 2, step: 1, temporalPhase: "seeking_step" }),
    frame({ elapsedMs: 7300, rep: 2, step: 1, temporalPhase: "step_hold", matchedStep: 1 }),
    frame({ elapsedMs: 7500, rep: 2, step: 2, temporalPhase: "step_peak", matchedStep: 2 }),
    frame({ elapsedMs: 7700, rep: 2, step: 3, temporalPhase: "rep_peak", matchedStep: 3 }),
    frame({ elapsedMs: 8000, rep: 2, step: 3, temporalPhase: "rep_complete", completedRep: 2 }),
    frame({ elapsedMs: 9000, rep: 3, step: 1, temporalPhase: "step_enter" }),
    frame({ elapsedMs: 9200, rep: 3, step: 1, temporalPhase: "step_exit" })
  ], {
    steps: [{}, {}, {}],
    targetReps: 3
  });

  assert.equal(analysis.repetitions.length, 2);
  assert.equal(analysis.repetitions[0].start_ms, 4200);
  assert.equal(analysis.repetitions[1].start_ms, 7300);
  assert.ok(
    analysis.repetitions[0].duration_ms >
      analysis.repetitions[1].duration_ms
  );
  assert.equal(analysis.clustered_completed_repetitions, 2);
});

test("repeated extension arcs split physical Jabs even when live rep labels merge them", () => {
  const extensionRanges = [
    [40, 105],
    [130, 166],
    [218, 255]
  ];
  const frames = Array.from({ length: 299 }, (_, index) => {
    const isExtension = extensionRanges.some(
      ([start, end]) => index >= start && index <= end
    );
    const rawRep = index < 187 ? 1 : index < 269 ? 2 : 3;
    const rawStep =
      index < 46
        ? 1
        : index < 130
          ? 2
          : index < 188
            ? 3
            : index < 218
              ? 1
              : index < 259
                ? 2
                : 3;
    return frame({
      elapsedMs: index * (1000 / 30),
      rep: rawRep,
      step: rawStep,
      temporalPhase: isExtension ? "step_enter" : "step_exit",
      stepScores: isExtension ? [10, 100, 10] : [100, 25, 100],
      completedRep: index === 187 ? 1 : index === 269 ? 2 : null,
      accuracy: 95,
      scorable: true
    });
  });

  const analysis = buildPracticeSessionAnalysis(frames, {
    steps: [{}, {}, {}],
    targetReps: 3
  });

  assert.equal(analysis.repetitions.length, 3);
  assert.equal(analysis.clustered_completed_repetitions, 3);
  assert.deepEqual(
    analysis.repetitions.map((repetition) => repetition.detected_steps),
    [[1, 2, 3], [1, 2, 3], [1, 2, 3]]
  );
  assert.equal(analysis.frame_assignments[75].rep, 1);
  assert.equal(analysis.frame_assignments[145].rep, 2);
  assert.equal(analysis.frame_assignments[235].rep, 3);
});

test("corrected session metrics use post-session repetitions as authority", () => {
  const metrics = buildPracticeSessionMetrics({
    repetitions: [
      {
        status: "completed",
        average_accuracy: 100,
        duration_ms: 3234
      },
      {
        status: "completed",
        average_accuracy: 98,
        duration_ms: 2067
      },
      {
        status: "completed",
        average_accuracy: 99,
        duration_ms: 2600
      },
      {
        status: "incomplete",
        average_accuracy: 100,
        duration_ms: 500
      }
    ]
  });

  assert.equal(metrics.completed_reps, 3);
  assert.equal(metrics.clean_reps, 3);
  assert.equal(metrics.average_accuracy, 99);
  assert.equal(metrics.best_accuracy, 100);
  assert.equal(metrics.average_rep_seconds, 2.634);
  assert.equal(metrics.consistency_score, 99.18);
});

test("missing repetition accuracy is excluded instead of counted as zero", () => {
  const metrics = buildPracticeSessionMetrics({
    repetitions: [
      { status: "completed", average_accuracy: null, duration_ms: 900 },
      { status: "completed", average_accuracy: 100, duration_ms: 700 },
      { status: "completed", average_accuracy: 100, duration_ms: 650 }
    ]
  });

  assert.equal(metrics.completed_reps, 3);
  assert.equal(metrics.average_accuracy, 100);
  assert.equal(metrics.consistency_score, 100);
});

test("score-driven clustering does not score recovery as the final step", () => {
  const frames = Array.from({ length: 18 }, (_, index) => {
    const isImpact = index >= 5 && index <= 7;
    const isReturn = index >= 14;
    return frame({
      elapsedMs: index * 100,
      rep: 1,
      step: isImpact ? 2 : 3,
      temporalPhase: isImpact
        ? "step_peak"
        : isReturn
          ? "step_hold"
          : "rep_recovery",
      stepScores: isImpact ? [10, 95, 10] : isReturn ? [92, 20, 90] : [35, 45, 40],
      accuracy: isImpact || isReturn ? 96 : 40,
      scorable: true
    });
  });

  const analysis = buildPracticeSessionAnalysis(frames, {
    steps: [{}, {}, {}],
    targetReps: 1
  });
  const recoveryAssignments = analysis.frame_assignments.slice(8, 14);

  assert.ok(recoveryAssignments.every((assignment) => assignment.phase === "rep_recovery"));
  assert.ok(recoveryAssignments.every((assignment) => assignment.step === null));
  assert.ok(recoveryAssignments.every((assignment) => assignment.scorable === false));
  assert.equal(analysis.repetitions[0].average_accuracy, 96);
});

test("standard timeline hides only outer segments and keeps middle transitions", () => {
  const analysis = {
    duration_ms: 5000,
    repetitions: [{ start_ms: 1000, end_ms: 4000 }],
    segments: [
      { kind: "preparation", start_ms: 0, end_ms: 1000, average_accuracy: null },
      { kind: "repetition", start_ms: 1000, end_ms: 1500, average_accuracy: 95 },
      { kind: "repetition", start_ms: 1500, end_ms: 3500, average_accuracy: null },
      { kind: "repetition", start_ms: 3500, end_ms: 4000, average_accuracy: 97 },
      { kind: "preparation", start_ms: 4000, end_ms: 5000, average_accuracy: null }
    ]
  };

  const standard = selectPracticeTimelineView(analysis);
  const advanced = selectPracticeTimelineView(analysis, { advanced: true });

  assert.deepEqual(standard.segments, [
    analysis.segments[1],
    analysis.segments[2],
    analysis.segments[3]
  ]);
  assert.equal(standard.start_ms, 1000);
  assert.equal(standard.end_ms, 4000);
  assert.equal(standard.hidden_segment_count, 2);
  assert.equal(advanced.segments.length, 5);
  assert.equal(advanced.start_ms, 0);
  assert.equal(advanced.end_ms, 5000);
});
