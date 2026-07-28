const PHASE_LABELS = Object.freeze({
  waiting_for_movement: "Preparation",
  seeking_step: "Seeking",
  between_steps: "Entry",
  step_enter: "Entry",
  step_hold: "Hold",
  step_peak: "Peak",
  step_exit: "Exit",
  rep_peak: "Peak",
  rep_recovery: "Recovery",
  rep_complete: "Complete",
  session_complete: "Complete",
  tracking_lost: "Tracking lost"
});

const finiteAverage = (values) => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
};

const frameRuleState = (frame) =>
  frame?.ruleEngineAnalysis?.corrected ||
  frame?.ruleEngineAnalysis?.raw ||
  null;

const frameErrors = (frame) => {
  const ruleErrors = frameRuleState(frame)?.form_errors;
  return [
    ...(Array.isArray(frame?.wrongBodyParts) ? frame.wrongBodyParts : []),
    ...(Array.isArray(ruleErrors) ? ruleErrors : [])
  ];
};

const CLUSTER_EVIDENCE_PHASES = new Set([
  "step_enter",
  "step_hold",
  "step_peak",
  "step_exit",
  "rep_peak",
  "rep_recovery",
  "rep_complete",
  "session_complete"
]);

const PROGRESSION_PHASES = new Set([
  "between_steps",
  "step_enter",
  "step_hold",
  "step_peak",
  "step_exit",
  "rep_peak",
  "rep_recovery",
  "rep_complete",
  "session_complete"
]);

function hasClusterEvidence(frame) {
  return (
    CLUSTER_EVIDENCE_PHASES.has(frame?.temporalPhase) ||
    (Number.isInteger(Number(frame?.matchedStep)) &&
      Number(frame.matchedStep) > 0) ||
    (Number.isInteger(Number(frame?.completedRep)) &&
      Number(frame.completedRep) > 0)
  );
}

const DEFAULT_CLUSTER_CONFIG = Object.freeze({
  impact_step: 2,
  minimum_impact_score: 80,
  impact_dominance_margin: 6,
  minimum_impact_frames: 3,
  maximum_impact_gap_frames: 2,
  minimum_return_score: 75,
  return_dominance_margin: 5,
  minimum_return_frames: 3,
  preparation_context_ms: 900,
  maximum_recovery_ms: 1200
});

function buildScoreDrivenWindows(frames, config = {}) {
  const settings = { ...DEFAULT_CLUSTER_CONFIG, ...(config || {}) };
  const impactStepIndex = Math.max(0, Number(settings.impact_step) - 1);
  const hasScoreEvidence = frames.some(
    (frame) =>
      Array.isArray(frame.stepScores) &&
      frame.stepScores.length > impactStepIndex + 1
  );
  if (!hasScoreEvidence || impactStepIndex <= 0) return [];

  const scoreAt = (frame, index) =>
    Number(frame?.stepScores?.[index]) || 0;
  const endpointScore = (frame) =>
    Math.max(
      scoreAt(frame, 0),
      scoreAt(frame, Math.max(0, frame.stepScores.length - 1))
    );
  const isImpact = (frame) => {
    const impactScore = scoreAt(frame, impactStepIndex);
    return (
      impactScore >= Number(settings.minimum_impact_score) &&
      impactScore - endpointScore(frame) >=
        Number(settings.impact_dominance_margin)
    );
  };
  const impactIndexes = frames
    .map((frame, index) => (isImpact(frame) ? index : null))
    .filter(Number.isInteger);
  if (!impactIndexes.length) return [];

  const impactRuns = [];
  impactIndexes.forEach((index) => {
    const current = impactRuns[impactRuns.length - 1];
    if (
      current &&
      index - current.end <= Number(settings.maximum_impact_gap_frames) + 1
    ) {
      current.end = index;
      current.confirmed_frames += 1;
      return;
    }
    impactRuns.push({ start: index, end: index, confirmed_frames: 1 });
  });
  const confirmedRuns = impactRuns.filter(
    (run) =>
      run.confirmed_frames >= Number(settings.minimum_impact_frames)
  );

  let previousEndIndex = -1;
  return confirmedRuns.map((run, runIndex) => {
    const impactStartMs = Number(frames[run.start]?.elapsedMs) || 0;
    const earliestContextMs = Math.max(
      0,
      impactStartMs - Number(settings.preparation_context_ms)
    );
    let startIndex = run.start;
    while (
      startIndex > previousEndIndex + 1 &&
      (Number(frames[startIndex - 1]?.elapsedMs) || 0) >= earliestContextMs
    ) {
      startIndex -= 1;
    }

    const nextImpactStart =
      confirmedRuns[runIndex + 1]?.start ?? frames.length;
    const maximumRecoveryMs =
      (Number(frames[run.end]?.elapsedMs) || 0) +
      Number(settings.maximum_recovery_ms);
    let returnRunStart = null;
    let returnRunLength = 0;
    let endIndex = run.end;
    for (
      let index = run.end + 1;
      index < nextImpactStart &&
      index < frames.length &&
      (Number(frames[index]?.elapsedMs) || 0) <= maximumRecoveryMs;
      index += 1
    ) {
      const frame = frames[index];
      const impactScore = scoreAt(frame, impactStepIndex);
      const returnScore = endpointScore(frame);
      const isReturn =
        returnScore >= Number(settings.minimum_return_score) &&
        returnScore - impactScore >= Number(settings.return_dominance_margin);
      if (isReturn) {
        if (returnRunStart === null) returnRunStart = index;
        returnRunLength += 1;
        if (returnRunLength >= Number(settings.minimum_return_frames)) {
          endIndex = index;
          break;
        }
      } else {
        returnRunStart = null;
        returnRunLength = 0;
      }
      endIndex = index;
    }
    const hasReturnSignal =
      returnRunStart !== null &&
      returnRunLength >= Number(settings.minimum_return_frames);
    if (!hasReturnSignal) {
      endIndex = Math.max(
        run.end,
        Math.min(endIndex, nextImpactStart - 1)
      );
    }

    const window = {
      rep: runIndex + 1,
      source_rep: Number(frames[run.start]?.rep) || null,
      start_index: Math.max(previousEndIndex + 1, startIndex),
      end_index: Math.max(run.end, endIndex),
      progression_index: run.start,
      impact_start_index: run.start,
      impact_end_index: run.end,
      has_completion_signal: hasReturnSignal,
      boundary_source: "score_cycle"
    };
    previousEndIndex = window.end_index;
    return window;
  });
}

function buildMovementDrivenWindows(
  frames,
  preparationContextMs = 900,
  clusterConfig = {}
) {
  const scoreDrivenWindows = buildScoreDrivenWindows(frames, {
    ...clusterConfig,
    preparation_context_ms:
      clusterConfig?.preparation_context_ms ?? preparationContextMs
  });
  if (scoreDrivenWindows.length) return scoreDrivenWindows;

  const sourceRepIds = [
    ...new Set(
      frames
        .map((frame) => Number(frame.rep))
        .filter((rep) => Number.isInteger(rep) && rep > 0)
    )
  ].sort((first, second) => first - second);
  const windows = [];

  sourceRepIds.forEach((sourceRep) => {
    const repIndexes = frames
      .map((frame, index) => ({ frame, index }))
      .filter(({ frame }) => Number(frame.rep) === sourceRep);
    const progression = repIndexes.find(({ frame }) =>
      Number(frame.step) > 1 &&
      PROGRESSION_PHASES.has(frame.temporalPhase)
    );
    if (!progression) return;

    const anchorMs = Number(progression.frame.elapsedMs) || 0;
    const earliestContextMs = Math.max(0, anchorMs - preparationContextMs);
    const openingContext = repIndexes.filter(({ frame, index }) =>
      index <= progression.index &&
      (Number(frame.elapsedMs) || 0) >= earliestContextMs &&
      Number(frame.step) === 1 &&
      hasClusterEvidence(frame)
    );
    const completion = [...repIndexes].reverse().find(({ frame }) =>
      Number(frame.completedRep) === sourceRep ||
      ["rep_complete", "session_complete"].includes(frame.temporalPhase)
    );
    const lastEvidence = [...repIndexes].reverse().find(({ frame }) =>
      hasClusterEvidence(frame)
    );
    const previousWindow = windows[windows.length - 1];
    const startIndex = Math.max(
      previousWindow ? previousWindow.end_index + 1 : 0,
      openingContext[0]?.index ?? progression.index
    );
    const endIndex = Math.max(
      startIndex,
      completion?.index ?? lastEvidence?.index ?? progression.index
    );

    windows.push({
      rep: windows.length + 1,
      source_rep: sourceRep,
      start_index: startIndex,
      end_index: endIndex,
      progression_index: progression.index,
      has_completion_signal: Boolean(completion),
      boundary_source: "classifier"
    });
  });

  return windows;
}

function frameKind(frame) {
  if (frame.temporalPhase === "tracking_lost") return "tracking";
  if (frame.temporalPhase === "session_complete") return "complete";
  return frame.analysisKind || "preparation";
}

function segmentKey(frame) {
  const kind = frameKind(frame);
  const phase = frame.analysisPhase ?? frame.temporalPhase;
  if (kind !== "repetition") return `${kind}:${phase || ""}`;
  return [
    kind,
    Number(frame.analysisRep) || 1,
    Number(frame.analysisStep ?? frame.step) || 1,
    phase || "seeking_step"
  ].join(":");
}

function closeSegment(segment, frames) {
  const segmentFrames = frames.slice(
    segment.start_frame_index,
    segment.end_frame_index + 1
  );
  const accuracies = segmentFrames
    .filter((frame) => frame.scorable !== false)
    .map((frame) => Number(frame.accuracy));
  const errors = new Set(segmentFrames.flatMap(frameErrors));
  const confidence = finiteAverage(
    segmentFrames.map((frame) => Number(frame.stateConfidence))
  );
  return {
    ...segment,
    frame_count: segmentFrames.length,
    duration_ms: Math.max(0, segment.end_ms - segment.start_ms),
    average_accuracy: finiteAverage(accuracies),
    confidence,
    errors: [...errors],
    has_review: errors.size > 0 ||
      accuracies.some((accuracy) => Number.isFinite(accuracy) && accuracy < 80)
  };
}

export function buildPracticeSessionAnalysis(
  frames,
  {
    steps = [],
    targetReps = null,
    strictSummary = null,
    clusterConfig = null
  } = {}
) {
  const orderedFrames = [...(frames || [])].sort(
    (first, second) =>
      Number(first.elapsedMs || 0) - Number(second.elapsedMs || 0)
  );
  if (!orderedFrames.length) {
    return {
      segments: [],
      repetitions: [],
      frame_assignments: [],
      preparation_duration_ms: 0,
      tracking_quality_percentage: 0,
      clustered_completed_repetitions: 0,
      strict_verified_repetitions:
        strictSummary?.completed_repetitions || 0,
      target_repetitions: Number(targetReps) || 0
    };
  }

  const repetitionWindows = buildMovementDrivenWindows(
    orderedFrames,
    clusterConfig?.preparation_context_ms,
    clusterConfig
  );
  const analysisFrames = orderedFrames.map((frame, index) => {
    const window = repetitionWindows.find(
      (candidate) =>
        index >= candidate.start_index && index <= candidate.end_index
    );
    const analysisStep = window?.impact_start_index === undefined
      ? Number(frame.step) || null
      : index < window.impact_start_index
        ? 1
        : index <= window.impact_end_index
          ? Number(clusterConfig?.impact_step) ||
            DEFAULT_CLUSTER_CONFIG.impact_step
          : Math.max(
              Number(clusterConfig?.impact_step) ||
                DEFAULT_CLUSTER_CONFIG.impact_step,
              steps.length || 3
            );
    const impactProgress = window?.impact_start_index === undefined
      ? null
      : (index - window.impact_start_index) /
        Math.max(1, window.impact_end_index - window.impact_start_index);
    const analysisPhase = window?.impact_start_index === undefined
      ? frame.temporalPhase
      : index < window.impact_start_index
        ? "step_hold"
        : index <= window.impact_end_index
          ? impactProgress < 0.25
            ? "step_enter"
            : impactProgress < 0.75
              ? "step_peak"
              : "step_exit"
          : index === window.end_index && window.has_completion_signal
            ? "rep_complete"
            : "rep_recovery";
    return {
      ...frame,
      analysisKind: window ? "repetition" : "preparation",
      analysisRep: window?.rep ?? null,
      analysisStep,
      analysisPhase,
      sourceRep: Number(frame.rep) || null
    };
  });
  const rawSegments = [];
  analysisFrames.forEach((frame, index) => {
    const key = segmentKey(frame);
    const elapsedMs = Number(frame.elapsedMs) || 0;
    const current = rawSegments[rawSegments.length - 1];
    if (current?.key === key) {
      current.end_frame_index = index;
      current.end_ms = elapsedMs;
      return;
    }
    rawSegments.push({
      key,
      kind: frameKind(frame),
      rep: Number(frame.analysisRep) || null,
      step: Number(frame.analysisStep ?? frame.step) || null,
      step_name:
        steps[
          Math.max(0, (Number(frame.analysisStep ?? frame.step) || 1) - 1)
        ]?.step_name ||
        (frame.analysisStep ?? frame.step
          ? `Step ${frame.analysisStep ?? frame.step}`
          : "Preparation"),
      phase: frame.analysisPhase ?? frame.temporalPhase ?? "seeking_step",
      phase_label:
        frameKind(frame) === "unconfirmed"
          ? "Unconfirmed"
          : PHASE_LABELS[frame.analysisPhase ?? frame.temporalPhase] ||
            "Movement",
      start_frame_index: index,
      end_frame_index: index,
      start_ms: elapsedMs,
      end_ms: elapsedMs
    });
  });
  const segments = rawSegments.map((segment) =>
    closeSegment(segment, analysisFrames)
  );

  const repetitions = repetitionWindows.map((window) => {
    const rep = window.rep;
    const repFrames = analysisFrames.filter(
      (frame) =>
        frameKind(frame) === "repetition" &&
        Number(frame.analysisRep) === rep
    );
    const repSegments = segments.filter(
      (segment) => segment.kind === "repetition" && segment.rep === rep
    );
    const errors = new Set(repFrames.flatMap(frameErrors));
    const accuracies = repFrames
      .filter((frame) => frame.scorable !== false)
      .map((frame) => Number(frame.accuracy));
    const detectedSteps = new Set(
      repSegments
        .filter((segment) => segment.phase !== "seeking_step")
        .map((segment) => segment.step)
    );
    const hasCompletionSignal = window.has_completion_signal;
    const hasFullStepCoverage =
      !steps.length || detectedSteps.size >= steps.length;
    const status =
      hasCompletionSignal && hasFullStepCoverage
        ? "completed"
        : hasCompletionSignal
          ? "partial"
          : "incomplete";
    return {
      rep,
      status,
      start_frame_index: repSegments[0]?.start_frame_index ?? 0,
      end_frame_index:
        repSegments[repSegments.length - 1]?.end_frame_index ?? 0,
      start_ms: repSegments[0]?.start_ms ?? 0,
      end_ms: repSegments[repSegments.length - 1]?.end_ms ?? 0,
      duration_ms: Math.max(
        0,
        (repSegments[repSegments.length - 1]?.end_ms ?? 0) -
          (repSegments[0]?.start_ms ?? 0)
      ),
      average_accuracy: finiteAverage(accuracies),
      confidence: finiteAverage(
        repFrames.map((frame) => Number(frame.stateConfidence))
      ),
      detected_steps: [...detectedSteps],
      step_coverage_percentage: steps.length
        ? Math.round((detectedSteps.size / steps.length) * 100)
        : 0,
      errors: [...errors],
      segments: repSegments
    };
  });

  const preparationSegments = segments.filter(
    (segment) => segment.kind === "preparation"
  );
  const trackedFrames = orderedFrames.filter(
    (frame) =>
      frame.trackingReliable !== false &&
      !frameRuleState(frame)?.tracking_lost
  );

  return {
    segments,
    repetitions,
    frame_assignments: analysisFrames.map((frame, index) => ({
      index,
      kind: frameKind(frame),
      rep: frame.analysisRep,
      step: frame.analysisStep,
      phase: frame.analysisPhase,
      source_rep: frame.sourceRep
    })),
    preparation_duration_ms: preparationSegments.reduce(
      (total, segment) => total + segment.duration_ms,
      0
    ),
    tracking_quality_percentage: Math.round(
      (trackedFrames.length / orderedFrames.length) * 100
    ),
    clustered_completed_repetitions: repetitions.filter(
      (repetition) => repetition.status === "completed"
    ).length,
    clustered_incomplete_repetitions: repetitions.filter(
      (repetition) => repetition.status !== "completed"
    ).length,
    unconfirmed_duration_ms: segments
      .filter((segment) => segment.kind === "unconfirmed")
      .reduce((total, segment) => total + segment.duration_ms, 0),
    strict_verified_repetitions:
      Number(strictSummary?.completed_repetitions) || 0,
    strict_incomplete_repetitions:
      Number(strictSummary?.aborted_repetitions) || 0,
    target_repetitions: Number(targetReps) || repetitions.length,
    duration_ms:
      Number(orderedFrames[orderedFrames.length - 1]?.elapsedMs) || 0
  };
}

export function buildPracticeSessionMetrics(
  analysis,
  { cleanAccuracy = 80 } = {}
) {
  const completed = (analysis?.repetitions || []).filter(
    (repetition) => repetition.status === "completed"
  );
  const accuracies = completed
    .map((repetition) => Number(repetition.average_accuracy))
    .filter(Number.isFinite);
  const durations = completed
    .map((repetition) => Number(repetition.duration_ms))
    .filter(Number.isFinite);
  const averageAccuracy = accuracies.length
    ? accuracies.reduce((total, value) => total + value, 0) /
      accuracies.length
    : 0;
  const variance = accuracies.length
    ? accuracies.reduce(
        (total, value) => total + (value - averageAccuracy) ** 2,
        0
      ) / accuracies.length
    : 0;

  return {
    completed_reps: completed.length,
    clean_reps: accuracies.filter((accuracy) => accuracy >= cleanAccuracy)
      .length,
    average_accuracy: Number(averageAccuracy.toFixed(2)),
    best_accuracy: accuracies.length ? Math.max(...accuracies) : 0,
    average_rep_seconds: durations.length
      ? Number(
          (
            durations.reduce((total, value) => total + value, 0) /
            durations.length /
            1000
          ).toFixed(3)
        )
      : 0,
    consistency_score: accuracies.length
      ? Number(Math.max(0, 100 - Math.sqrt(variance)).toFixed(2))
      : 0
  };
}
