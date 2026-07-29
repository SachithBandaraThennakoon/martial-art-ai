import { calculateRuleConfidence, evaluateRule } from "./ruleEvaluator.js";

function durationPlausibility(durationMs, stateDefinition) {
  if (!stateDefinition || durationMs < 0) return 0;
  if (durationMs < stateDefinition.min_duration_ms) {
    return Math.max(0, durationMs / Math.max(stateDefinition.min_duration_ms, 1));
  }
  if (durationMs <= stateDefinition.max_duration_ms) return 1;
  return Math.max(
    0,
    1 - (durationMs - stateDefinition.max_duration_ms) /
      Math.max(stateDefinition.max_duration_ms, 1)
  );
}

function hysteresisSatisfied(stateDefinition, features) {
  const thresholds = stateDefinition?.exit_hysteresis;
  if (!thresholds) return null;
  const enterRules = stateDefinition.enter_rules?.all || [];

  return Object.entries(thresholds).every(([feature, threshold]) => {
    const value = features?.[feature];
    const entryCondition = enterRules.find((rule) => rule.feature === feature);
    if (!Number.isFinite(value) || !entryCondition) return false;
    if (["lte", "lt"].includes(entryCondition.operator)) return value <= threshold;
    if (["gte", "gt"].includes(entryCondition.operator)) return value >= threshold;
    if (entryCondition.operator === "between") {
      if (threshold < entryCondition.min) return value >= threshold;
      if (threshold > entryCondition.max) return value <= threshold;
    }
    return false;
  });
}

export class TemporalStateMachine {
  constructor(techniquePackage, { mode = "train" } = {}) {
    if (!techniquePackage?.stateNames?.length) {
      throw new Error("TemporalStateMachine requires a validated technique package");
    }
    this.techniquePackage = techniquePackage;
    this.mode = mode;
    this.policy = techniquePackage.getMode(mode);
    if (!this.policy) throw new Error(`Technique does not configure mode "${mode}"`);
    this.reset();
  }

  reset() {
    this.currentState = null;
    this.stateStartedAtMs = null;
    this.candidateState = null;
    this.candidateStartedAtMs = null;
    this.candidateFrames = 0;
    this.previousFeatures = {};
    this.lastTimestampMs = null;
    this.sequence = 0;
    this.lastConfidence = 0;
  }

  clearCandidate() {
    this.candidateState = null;
    this.candidateStartedAtMs = null;
    this.candidateFrames = 0;
  }

  setCandidate(stateName, timestampMs) {
    if (this.candidateState === stateName) {
      this.candidateFrames += 1;
      return;
    }
    this.candidateState = stateName;
    this.candidateStartedAtMs = timestampMs;
    this.candidateFrames = 1;
  }

  commit(stateName, timestampMs, confidence, evidence, eventType = "state_transition") {
    const previousState = this.currentState;
    const transitionDefinition = previousState
      ? this.techniquePackage.transitions.transitions[previousState]
      : null;
    this.currentState = stateName;
    this.stateStartedAtMs = timestampMs;
    this.lastConfidence = confidence;
    this.clearCandidate();
    this.sequence += 1;

    return {
      id: `${Math.round(timestampMs)}:${this.sequence}`,
      type: eventType,
      timestamp_ms: timestampMs,
      from_state: previousState,
      to_state: stateName,
      confidence,
      evidence,
      repetition_completed:
        Boolean(previousState && transitionDefinition?.completes_repetition)
    };
  }

  update({ timestampMs, features = {}, trackingConfidence = 1 }) {
    if (!Number.isFinite(timestampMs)) return null;
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      throw new Error("Temporal state timestamps must be monotonic");
    }
    this.lastTimestampMs = timestampMs;

    if (trackingConfidence < this.policy.tracking_confidence_min) {
      this.clearCandidate();
      this.previousFeatures = { ...features };
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        trackingLost: true,
        event: null,
        evaluations: []
      });
    }

    if (!this.currentState) {
      const initialState = this.techniquePackage.manifest.initial_state;
      const definition = this.techniquePackage.getState(initialState);
      const evaluation = evaluateRule(definition.enter_rules, features, {
        previousFeatures: this.previousFeatures
      });
      const confidenceResult = calculateRuleConfidence({
        evaluation,
        trackingConfidence,
        temporalConsistency: this.candidateState === initialState ? 1 : 0.75,
        validPreviousState: 1,
        durationPlausibility: 1
      });
      const qualified =
        evaluation.satisfied &&
        confidenceResult.confidence >= this.policy.transition_confidence_min;

      if (qualified) this.setCandidate(initialState, timestampMs);
      else this.clearCandidate();

      const confirmed =
        qualified &&
        this.candidateFrames >= definition.confirmation.min_frames &&
        timestampMs - this.candidateStartedAtMs >= definition.confirmation.min_ms;
      const event = confirmed
        ? this.commit(
            initialState,
            timestampMs,
            confidenceResult.confidence,
            evaluation,
            "state_initialized"
          )
        : null;
      this.previousFeatures = { ...features };
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        event,
        evaluations: [{ state: initialState, evaluation, confidenceResult }]
      });
    }

    const currentDefinition = this.techniquePackage.getState(this.currentState);
    const stateDurationMs = timestampMs - this.stateStartedAtMs;
    const transitionDefinition =
      this.techniquePackage.transitions.transitions[this.currentState];
    const timeoutMs = transitionDefinition.timeout_ms ?? currentDefinition.max_duration_ms;
    if (stateDurationMs > timeoutMs) {
      const timedOutState = this.currentState;
      this.currentState = null;
      this.stateStartedAtMs = null;
      this.clearCandidate();
      this.sequence += 1;
      this.previousFeatures = { ...features };
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        event: {
          id: `${Math.round(timestampMs)}:${this.sequence}`,
          type: "state_timeout",
          timestamp_ms: timestampMs,
          from_state: timedOutState,
          to_state: null,
          action: transitionDefinition.timeout_action || "RESET",
          repetition_completed: false
        },
        evaluations: [],
        timedOut: true
      });
    }

    const evaluations = transitionDefinition.allowed.map((stateName) => {
      const definition = this.techniquePackage.getState(stateName);
      const evaluation = evaluateRule(definition.enter_rules, features, {
        previousFeatures: this.previousFeatures
      });
      const confidenceResult = calculateRuleConfidence({
        evaluation,
        trackingConfidence,
        temporalConsistency: this.candidateState === stateName ? 1 : 0.78,
        validPreviousState: this.techniquePackage.canTransition(
          this.currentState,
          stateName
        ) ? 1 : 0,
        durationPlausibility: durationPlausibility(
          stateDurationMs,
          currentDefinition
        )
      });
      return { state: stateName, definition, evaluation, confidenceResult };
    });
    const best = evaluations
      .filter(({ evaluation, confidenceResult }) =>
        evaluation.satisfied &&
        confidenceResult.confidence >= this.policy.transition_confidence_min
      )
      .sort((first, second) =>
        second.confidenceResult.confidence - first.confidenceResult.confidence
      )[0];
    const mayExit = stateDurationMs >= currentDefinition.min_duration_ms;

    if (best && mayExit) this.setCandidate(best.state, timestampMs);
    else this.clearCandidate();

    const confirmed =
      best &&
      mayExit &&
      this.candidateState === best.state &&
      this.candidateFrames >= best.definition.confirmation.min_frames &&
      timestampMs - this.candidateStartedAtMs >= best.definition.confirmation.min_ms;
    const event = confirmed
      ? this.commit(
          best.state,
          timestampMs,
          best.confidenceResult.confidence,
          best.evaluation
        )
      : null;
    const currentEvaluation = evaluateRule(
      currentDefinition.enter_rules,
      features,
      { previousFeatures: this.previousFeatures }
    );
    const withinHysteresis = hysteresisSatisfied(currentDefinition, features);
    const unknownMovement =
      !event &&
      !best &&
      !currentEvaluation.satisfied &&
      withinHysteresis !== true;
    this.previousFeatures = { ...features };

    return this.snapshot({
      timestampMs,
      trackingConfidence,
      event,
      evaluations,
      unknownMovement,
      withinHysteresis
    });
  }

  updateLearned({
    timestampMs,
    stateProbabilities,
    trackingConfidence = 1
  }) {
    if (!Number.isFinite(timestampMs)) return null;
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      throw new Error("Temporal state timestamps must be monotonic");
    }
    this.lastTimestampMs = timestampMs;

    if (trackingConfidence < this.policy.tracking_confidence_min) {
      this.clearCandidate();
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        trackingLost: true,
        evaluations: []
      });
    }

    const ranked = Object.entries(stateProbabilities || {})
      .filter(([, probability]) => Number.isFinite(probability))
      .sort((first, second) => second[1] - first[1]);
    const [predictedState, predictedConfidence = 0] = ranked[0] || [];
    if (!predictedState) {
      this.clearCandidate();
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        evaluations: []
      });
    }
    if (predictedState === "__TRACKING_LOST__") {
      this.clearCandidate();
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        trackingLost: true,
        evaluations: []
      });
    }

    const confident =
      predictedConfidence >= this.policy.transition_confidence_min;
    if (!this.currentState) {
      const initialState = this.techniquePackage.manifest.initial_state;
      const definition = this.techniquePackage.getState(initialState);
      if (confident && predictedState === initialState) {
        this.setCandidate(initialState, timestampMs);
      } else {
        this.clearCandidate();
      }
      const confirmed =
        this.candidateState === initialState &&
        this.candidateFrames >= definition.confirmation.min_frames &&
        timestampMs - this.candidateStartedAtMs >= definition.confirmation.min_ms;
      const evidence = {
        origin: "learned_model",
        state: predictedState,
        probability: predictedConfidence
      };
      const event = confirmed
        ? this.commit(
            initialState,
            timestampMs,
            predictedConfidence,
            evidence,
            "state_initialized"
          )
        : null;
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        event,
        evaluations: [{
          state: predictedState,
          evaluation: evidence,
          confidenceResult: { confidence: predictedConfidence }
        }],
        unknownMovement: confident && predictedState === "__UNKNOWN__"
      });
    }

    const currentDefinition = this.techniquePackage.getState(this.currentState);
    const stateDurationMs = timestampMs - this.stateStartedAtMs;
    const transitionDefinition =
      this.techniquePackage.transitions.transitions[this.currentState];
    const timeoutMs =
      transitionDefinition.timeout_ms ?? currentDefinition.max_duration_ms;
    if (stateDurationMs > timeoutMs) {
      const timedOutState = this.currentState;
      this.currentState = null;
      this.stateStartedAtMs = null;
      this.clearCandidate();
      this.sequence += 1;
      return this.snapshot({
        timestampMs,
        trackingConfidence,
        event: {
          id: `${Math.round(timestampMs)}:${this.sequence}`,
          type: "state_timeout",
          timestamp_ms: timestampMs,
          from_state: timedOutState,
          to_state: null,
          action: transitionDefinition.timeout_action || "RESET",
          repetition_completed: false
        },
        evaluations: [],
        timedOut: true
      });
    }

    const allowed =
      confident &&
      transitionDefinition.allowed.includes(predictedState) &&
      stateDurationMs >= currentDefinition.min_duration_ms;
    if (allowed) this.setCandidate(predictedState, timestampMs);
    else this.clearCandidate();

    const targetDefinition = allowed
      ? this.techniquePackage.getState(predictedState)
      : null;
    const confirmed =
      targetDefinition &&
      this.candidateFrames >= targetDefinition.confirmation.min_frames &&
      timestampMs - this.candidateStartedAtMs >= targetDefinition.confirmation.min_ms;
    const evidence = {
      origin: "learned_model",
      state: predictedState,
      probability: predictedConfidence
    };
    const event = confirmed
      ? this.commit(
          predictedState,
          timestampMs,
          predictedConfidence,
          evidence
        )
      : null;
    const unknownMovement =
      confident &&
      predictedState !== this.currentState &&
      predictedState === "__UNKNOWN__";

    return this.snapshot({
      timestampMs,
      trackingConfidence,
      event,
      evaluations: [{
        state: predictedState,
        evaluation: evidence,
        confidenceResult: { confidence: predictedConfidence }
      }],
      unknownMovement
    });
  }

  snapshot({
    timestampMs,
    trackingConfidence,
    trackingLost = false,
    event = null,
    evaluations = [],
    unknownMovement = false,
    withinHysteresis = null,
    timedOut = false
  }) {
    const stateDurationMs = this.currentState && Number.isFinite(this.stateStartedAtMs)
      ? Math.max(0, timestampMs - this.stateStartedAtMs)
      : 0;
    const phase = event
      ? "ENTRY"
      : this.candidateState
        ? "EXIT"
        : this.currentState
          ? "HOLD"
          : null;

    return {
      timestamp_ms: timestampMs,
      state: this.currentState,
      phase,
      state_duration_ms: stateDurationMs,
      candidate_state: this.candidateState,
      candidate_frames: this.candidateFrames,
      candidate_duration_ms: this.candidateStartedAtMs === null
        ? 0
        : Math.max(0, timestampMs - this.candidateStartedAtMs),
      confidence: event?.confidence ?? this.lastConfidence,
      tracking_confidence: trackingConfidence,
      tracking_lost: trackingLost,
      unknown_movement: unknownMovement,
      within_hysteresis: withinHysteresis,
      timed_out: timedOut,
      event,
      rule_evidence: evaluations.map(({ state, evaluation, confidenceResult }) => ({
        state,
        satisfied: evaluation.satisfied,
        confidence: confidenceResult.confidence,
        confidence_components: confidenceResult.components,
        evaluation
      }))
    };
  }
}
