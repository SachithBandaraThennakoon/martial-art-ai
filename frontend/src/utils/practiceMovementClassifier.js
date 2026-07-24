const DEFAULTS = {
  matchThreshold: 70,
  matchMargin: 6,
  minMotionScore: 0.025,
  fastImpactThreshold: 62,
  fastImpactMotionScore: 0.05,
  stableFrames: 2
};

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
  let movementSeen = false;
  let impactCandidateSeen = false;
  let completed = false;

  return {
    reset() {
      expectedStepIndex = 0;
      currentRep = 1;
      stableMatchFrames = 0;
      movementSeen = false;
      impactCandidateSeen = false;
      completed = false;
    },

    update({ motionScore = 0, stepScores = [] } = {}) {
      const frameRep = Math.min(currentRep, totalReps);
      const frameStep = expectedStepIndex + 1;

      if (completed) {
        return {
          rep: totalReps,
          step: totalSteps,
          expectedStep: totalSteps,
          phase: "complete",
          scorable: false,
          matchedStep: null,
          countedRep: null,
          completedRep: null,
          completed: true
        };
      }

      const numericMotionScore = Number(motionScore) || 0;
      if (numericMotionScore >= config.minMotionScore) {
        movementSeen = true;
      }

      const expectedScore = Number(stepScores[expectedStepIndex]) || 0;
      const bestScore = Math.max(0, ...stepScores.map((score) => Number(score) || 0));
      const expectedIsBest = expectedScore >= bestScore - config.matchMargin;
      const isInitialKeyframe = currentRep === 1 && expectedStepIndex === 0;
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
        expectedScore >= config.fastImpactThreshold &&
        expectedIsBest;
      const deferredImpactMatch =
        isImpactStep && impactCandidateSeen && !fastImpactCandidate;

      if (fastImpactCandidate) {
        impactCandidateSeen = true;
      }
      stableMatchFrames =
        !isImpactStep && matchesExpected ? stableMatchFrames + 1 : 0;

      if (!deferredImpactMatch && stableMatchFrames < config.stableFrames) {
        return {
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          phase: fastImpactCandidate || matchesExpected ? "keyframe" : "transition",
          scorable: fastImpactCandidate || matchesExpected,
          matchedStep: null,
          countedRep: null,
          completedRep: null,
          completed: false
        };
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
        expectedStepIndex += 1;
        return {
          rep: frameRep,
          step: matchedStep,
          expectedStep: expectedStepIndex + 1,
          phase: matchedPhase,
          scorable: matchedScorable,
          matchedStep,
          matchKind,
          countedRep,
          completedRep: null,
          completed: false
        };
      }

      const completedRep = currentRep;
      if (currentRep >= totalReps) {
        completed = true;
      } else {
        currentRep += 1;
        expectedStepIndex = 0;
      }

      return {
        rep: completedRep,
        step: matchedStep,
        expectedStep: completed ? totalSteps : expectedStepIndex + 1,
        phase: matchedPhase,
        scorable: matchedScorable,
        matchedStep,
        matchKind,
        countedRep,
        completedRep,
        completed
      };
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
