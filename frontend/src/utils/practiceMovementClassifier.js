const DEFAULTS = {
  matchThreshold: 70,
  matchMargin: 6,
  exitThreshold: 58,
  minMotionScore: 0.025,
  fastImpactThreshold: 62,
  fastImpactMotionScore: 0.05,
  stableFrames: 3,
  exitFrames: 2,
  recoveryFrames: 3,
  minTrackingConfidence: 0.55,
  maxUnreliableFrames: 4,
  scoreSmoothingAlpha: 0.58
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createPracticeMovementClassifier({
  countStep,
  stepCount,
  targetReps,
  ...overrides
}) {
  const config = { ...DEFAULTS, ...overrides };
  const totalSteps = Math.max(1, Number(stepCount) || 1);
  const totalReps = Math.max(1, Number(targetReps) || 1);
  const hasExplicitCountStep = Number.isFinite(Number(countStep));
  const countStepIndex = Math.max(
    0,
    Math.min(totalSteps - 1, (Number(countStep) || totalSteps) - 1)
  );
  let expectedStepIndex = 0;
  let currentRep = 1;
  let stableMatchFrames = 0;
  let stableExitFrames = 0;
  let recoveryFrames = 0;
  let unreliableFrames = 0;
  let movementSeen = false;
  let impactCandidateSeen = false;
  let awaitingStepExit = false;
  let exitingStepIndex = null;
  let pendingCompletedRep = null;
  let smoothedStepScores = [];
  let completed = false;

  const createResult = ({
    rep = Math.min(currentRep, totalReps),
    step = expectedStepIndex + 1,
    expectedStep = expectedStepIndex + 1,
    phase = "transition",
    temporalPhase = "waiting_for_movement",
    scorable = false,
    matchedStep = null,
    matchKind,
    countedRep = null,
    completedRep = null,
    stateConfidence = 0,
    trackingReliable = true
  } = {}) => ({
    rep,
    step,
    expectedStep,
    phase,
    temporalPhase,
    sequenceState: completed
      ? "complete"
      : pendingCompletedRep
        ? "recovering"
        : awaitingStepExit
          ? "transitioning"
          : "classifying",
    scorable,
    matchedStep,
    ...(matchKind ? { matchKind } : {}),
    countedRep,
    completedRep,
    stateConfidence: Math.round(clamp(stateConfidence, 0, 100)),
    trackingReliable,
    completed
  });

  return {
    reset() {
      expectedStepIndex = 0;
      currentRep = 1;
      stableMatchFrames = 0;
      stableExitFrames = 0;
      recoveryFrames = 0;
      unreliableFrames = 0;
      movementSeen = false;
      impactCandidateSeen = false;
      awaitingStepExit = false;
      exitingStepIndex = null;
      pendingCompletedRep = null;
      smoothedStepScores = [];
      completed = false;
    },

    update({
      motionScore = 0,
      stepScores = [],
      trackingConfidence = 1
    } = {}) {
      const frameRep = Math.min(currentRep, totalReps);
      const frameStep = expectedStepIndex + 1;

      if (completed) {
        return createResult({
          rep: totalReps,
          step: totalSteps,
          expectedStep: totalSteps,
          phase: "complete",
          temporalPhase: "session_complete",
          scorable: false,
          stateConfidence: 100
        });
      }

      const numericMotionScore = Number(motionScore) || 0;
      const numericTrackingConfidence = Number.isFinite(Number(trackingConfidence))
        ? Number(trackingConfidence)
        : 1;
      const numericScores = Array.from(
        { length: totalSteps },
        (_, index) => Number(stepScores[index]) || 0
      );
      smoothedStepScores = numericScores.map((score, index) => {
        const previous = smoothedStepScores[index];
        if (!Number.isFinite(previous)) return score;
        return (
          previous * (1 - config.scoreSmoothingAlpha) +
          score * config.scoreSmoothingAlpha
        );
      });

      if (numericTrackingConfidence < config.minTrackingConfidence) {
        unreliableFrames += 1;
        if (unreliableFrames > config.maxUnreliableFrames) {
          stableMatchFrames = 0;
          stableExitFrames = 0;
          impactCandidateSeen = false;
        }
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          temporalPhase: "tracking_lost",
          stateConfidence: numericTrackingConfidence * 100,
          trackingReliable: false
        });
      }
      unreliableFrames = 0;

      if (numericMotionScore >= config.minMotionScore) {
        movementSeen = true;
      }

      if (pendingCompletedRep) {
        const finalScore = smoothedStepScores[totalSteps - 1] || 0;
        const requiresPoseRelease =
          totalSteps === 1 || countStepIndex === totalSteps - 1;
        const poseReleased = finalScore <= config.exitThreshold;
        stableExitFrames = poseReleased ? stableExitFrames + 1 : 0;
        recoveryFrames =
          numericMotionScore < config.minMotionScore
            ? recoveryFrames + 1
            : 0;
        const recoveryConfirmed =
          stableExitFrames >= config.exitFrames ||
          (!requiresPoseRelease && recoveryFrames >= config.recoveryFrames);

        if (!recoveryConfirmed) {
          return createResult({
            rep: pendingCompletedRep,
            step: totalSteps,
            expectedStep: totalSteps,
            temporalPhase: "rep_recovery",
            stateConfidence: Math.max(100 - finalScore, recoveryFrames * 25)
          });
        }

        const completedRep = pendingCompletedRep;
        pendingCompletedRep = null;
        stableExitFrames = 0;
        recoveryFrames = 0;
        movementSeen = false;
        impactCandidateSeen = false;
        smoothedStepScores = [];

        if (completedRep >= totalReps) {
          completed = true;
        } else {
          currentRep += 1;
          expectedStepIndex = 0;
        }

        return createResult({
          rep: completedRep,
          step: totalSteps,
          expectedStep: completed ? totalSteps : 1,
          temporalPhase: completed ? "session_complete" : "rep_complete",
          completedRep,
          stateConfidence: 100
        });
      }

      if (awaitingStepExit) {
        const previousScore = smoothedStepScores[exitingStepIndex] || 0;
        const nextScore = smoothedStepScores[expectedStepIndex] || 0;
        const nextClearlyLeads =
          nextScore >= config.matchThreshold &&
          nextScore >= previousScore + config.matchMargin;
        const exitedPrevious =
          previousScore <= config.exitThreshold || nextClearlyLeads;
        stableExitFrames = exitedPrevious ? stableExitFrames + 1 : 0;

        if (stableExitFrames < config.exitFrames) {
          return createResult({
            rep: frameRep,
            step: (exitingStepIndex ?? 0) + 1,
            expectedStep: frameStep,
            temporalPhase: "step_exit",
            stateConfidence: 100 - previousScore
          });
        }

        awaitingStepExit = false;
        exitingStepIndex = null;
        stableExitFrames = 0;
        stableMatchFrames = 0;
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          temporalPhase: "between_steps",
          stateConfidence: Math.max(nextScore, 100 - previousScore)
        });
      }

      const expectedScore = smoothedStepScores[expectedStepIndex] || 0;
      const rawExpectedScore = numericScores[expectedStepIndex] || 0;
      const bestScore = Math.max(0, ...smoothedStepScores);
      const expectedIsBest = expectedScore >= bestScore - config.matchMargin;
      const isInitialKeyframe = expectedStepIndex === 0;
      const matchesExpected =
        (movementSeen || isInitialKeyframe) &&
        expectedScore >= config.matchThreshold &&
        expectedIsBest;
      const isImpactStep =
        hasExplicitCountStep &&
        expectedStepIndex === countStepIndex;
      const fastImpactCandidate =
        isImpactStep &&
        movementSeen &&
        numericMotionScore >= config.fastImpactMotionScore &&
        rawExpectedScore >= config.fastImpactThreshold &&
        expectedIsBest;
      const deferredImpactMatch =
        isImpactStep && impactCandidateSeen && !fastImpactCandidate;

      if (fastImpactCandidate) {
        impactCandidateSeen = true;
      }
      stableMatchFrames =
        !isImpactStep && matchesExpected ? stableMatchFrames + 1 : 0;

      if (!deferredImpactMatch && stableMatchFrames < config.stableFrames) {
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          phase: fastImpactCandidate || matchesExpected ? "keyframe" : "transition",
          temporalPhase: fastImpactCandidate
            ? "step_peak"
            : matchesExpected
              ? "step_enter"
              : movementSeen
                ? "seeking_step"
                : "waiting_for_movement",
          scorable: fastImpactCandidate || matchesExpected,
          stateConfidence: fastImpactCandidate ? rawExpectedScore : expectedScore
        });
      }

      const matchedStep = frameStep;
      const countedRep =
        expectedStepIndex === countStepIndex ? currentRep : null;
      const matchKind = deferredImpactMatch ? "impact-peak" : "stable";
      stableMatchFrames = 0;
      movementSeen =
        deferredImpactMatch && numericMotionScore >= config.minMotionScore;
      impactCandidateSeen = false;
      const matchedPhase = deferredImpactMatch ? "transition" : "keyframe";
      const matchedScorable = !deferredImpactMatch;

      if (expectedStepIndex < totalSteps - 1) {
        const matchedStepIndex = expectedStepIndex;
        expectedStepIndex += 1;
        if (!deferredImpactMatch) {
          awaitingStepExit = true;
          exitingStepIndex = matchedStepIndex;
        }
        return createResult({
          rep: frameRep,
          step: matchedStep,
          expectedStep: expectedStepIndex + 1,
          phase: matchedPhase,
          temporalPhase: deferredImpactMatch ? "step_exit" : "step_hold",
          scorable: matchedScorable,
          matchedStep,
          matchKind,
          countedRep,
          stateConfidence: expectedScore
        });
      }

      pendingCompletedRep = currentRep;
      recoveryFrames = 0;
      stableExitFrames = 0;
      return createResult({
        rep: currentRep,
        step: matchedStep,
        expectedStep: totalSteps,
        phase: matchedPhase,
        temporalPhase: "rep_peak",
        scorable: matchedScorable,
        matchedStep,
        matchKind,
        countedRep,
        stateConfidence: expectedScore
      });
    },

    getState() {
      return {
        rep: Math.min(currentRep, totalReps),
        expectedStep: expectedStepIndex + 1,
        completed
      };
    }
  };
}

function averageEvidence(frames, centerIndex, key, radius = 2) {
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(frames.length, centerIndex + radius + 1);
  const values = frames
    .slice(start, end)
    .map((frame) => Number(frame?.[key]))
    .filter(Number.isFinite);

  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function smoothStepEvidence(frames, centerIndex, stepCount, radius = 2) {
  return Array.from({ length: stepCount }, (_, stepIndex) => {
    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(frames.length, centerIndex + radius + 1);
    const values = frames
      .slice(start, end)
      .map((frame) => Number(frame?.stepScores?.[stepIndex]))
      .filter(Number.isFinite);

    if (!values.length) return 0;
    return values.reduce((total, value) => total + value, 0) / values.length;
  });
}

export function reclassifyPracticeSequence(
  frames,
  {
    countStep,
    stepCount,
    targetReps,
    evidenceRadius = 2,
    ...classifierOverrides
  }
) {
  if (!frames?.length) return [];

  const totalSteps = Math.max(1, Number(stepCount) || 1);
  const classifier = createPracticeMovementClassifier({
    countStep,
    stepCount: totalSteps,
    targetReps,
    ...classifierOverrides
  });
  let lastSourceTimestamp = null;
  let lastClassification = null;

  return frames.map((frame, index) => {
    const sourceTimestamp = Number(frame.sourceTimestampMs);
    const isDuplicateSource =
      Number.isFinite(sourceTimestamp) &&
      sourceTimestamp === lastSourceTimestamp &&
      lastClassification;
    const classification = isDuplicateSource
      ? lastClassification
      : classifier.update({
          motionScore:
            averageEvidence(frames, index, "motionScore", evidenceRadius) ||
            frame.motionScore ||
            0,
          stepScores: smoothStepEvidence(
            frames,
            index,
            totalSteps,
            evidenceRadius
          ),
          trackingConfidence:
            averageEvidence(
              frames,
              index,
              "trackingConfidence",
              evidenceRadius
            ) ?? frame.trackingConfidence ?? 1
        });

    if (!isDuplicateSource) {
      lastSourceTimestamp = Number.isFinite(sourceTimestamp)
        ? sourceTimestamp
        : null;
      lastClassification = classification;
    }

    return {
      ...frame,
      liveRep: frame.rep,
      liveStep: frame.step,
      livePhase: frame.phase,
      liveTemporalPhase: frame.temporalPhase,
      rep: classification.rep,
      step: classification.step,
      phase: classification.phase,
      temporalPhase: classification.temporalPhase,
      stateConfidence: classification.stateConfidence,
      trackingReliable: classification.trackingReliable,
      scorable: classification.scorable,
      postSessionClassified: true
    };
  });
}

export function attachCountAttention(frames, countMarkers, gapMs) {
  const toleranceMs = Math.max(160, Math.round(gapMs * 0.14));
  const markers = countMarkers.map((marker, index) => {
    const windowStart = Math.max(0, marker.elapsedMs - gapMs * 0.25);
    const windowEnd = countMarkers[index + 1]?.elapsedMs ?? marker.elapsedMs + gapMs;
    const candidates = frames.filter(
      (frame) => frame.elapsedMs >= windowStart && frame.elapsedMs <= windowEnd
    );
    const peak = candidates.reduce(
      (best, frame) => (!best || frame.motionScore > best.motionScore ? frame : best),
      null
    );
    const offsetMs = peak ? Math.round(peak.elapsedMs - marker.elapsedMs) : null;
    const timing = !Number.isFinite(offsetMs)
      ? "no-response"
      : offsetMs < -toleranceMs
        ? "early"
        : offsetMs > toleranceMs
          ? "late"
          : "on-time";

    return {
      ...marker,
      cue: index + 1,
      movementPeakMs: peak?.elapsedMs ?? null,
      offsetMs,
      timing
    };
  });

  return frames.map((frame) => {
    const marker =
      [...markers].reverse().find((candidate) => candidate.elapsedMs <= frame.elapsedMs) ||
      markers[0];

    return {
      ...frame,
      countCue: marker?.cue ?? null,
      countTimestampMs: marker?.elapsedMs ?? null,
      attentionOffsetMs: marker?.offsetMs ?? null,
      attentionTiming: marker?.timing || "no-response",
      movementPeakMs: marker?.movementPeakMs ?? null
    };
  });
}

export function filterPracticeTapeFrames(
  frames,
  { rep = "all", step = "all" } = {}
) {
  return frames
    .map((frame, index) => ({ frame, index }))
    .filter(
      ({ frame }) =>
        (rep === "all" || frame.rep === Number(rep)) &&
        (step === "all" ||
          (frame.step === Number(step) && frame.scorable !== false))
    );
}
