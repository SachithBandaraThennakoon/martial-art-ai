import { calculateRuleConfidence, evaluateRule } from "./ruleEvaluator.js";

export class PersistentErrorEvaluator {
  constructor(errorRules = []) {
    this.errorRules = errorRules;
    this.reset();
  }

  reset() {
    this.candidates = new Map();
    this.active = new Map();
    this.occurrences = [];
    this.sequence = 0;
  }

  update({
    timestampMs,
    state,
    features = {},
    trackingConfidence = 1,
    evaluationContext = {}
  }) {
    const events = [];

    this.errorRules.forEach((rule) => {
      const applicableDuringTemporalState =
        rule.evaluate_during?.includes(state);
      const practiceStep = Number(evaluationContext.practice_step);
      const applicableDuringPracticeStep =
        evaluationContext.scorable !== false &&
        Number.isInteger(practiceStep) &&
        rule.evaluate_practice_steps?.includes(practiceStep);
      const applicable =
        applicableDuringTemporalState || applicableDuringPracticeStep;
      const evaluation = applicable
        ? evaluateRule(rule.condition, features)
        : null;
      const satisfied = Boolean(applicable && evaluation?.satisfied);

      if (!satisfied || trackingConfidence <= 0) {
        this.candidates.delete(rule.id);
        if (this.active.has(rule.id)) {
          this.active.delete(rule.id);
          this.sequence += 1;
          events.push({
            id: `${Math.round(timestampMs)}:error:${this.sequence}`,
            type: "form_error_cleared",
            timestamp_ms: timestampMs,
            error_id: rule.id,
            severity: rule.severity
          });
        }
        return;
      }

      const candidate = this.candidates.get(rule.id) || {
        startedAtMs: timestampMs,
        frames: 0
      };
      candidate.frames += 1;
      this.candidates.set(rule.id, candidate);
      const confirmed =
        candidate.frames >= rule.confirmation.min_frames &&
        timestampMs - candidate.startedAtMs >= rule.confirmation.min_ms;

      if (!confirmed || this.active.has(rule.id)) return;

      const confidenceResult = calculateRuleConfidence({
        evaluation,
        trackingConfidence,
        temporalConsistency: Math.min(
          1,
          candidate.frames / rule.confirmation.min_frames
        ),
        validPreviousState: 1,
        durationPlausibility: 1
      });
      const occurrence = {
        error_id: rule.id,
        severity: rule.severity,
        state,
        started_at_ms: candidate.startedAtMs,
        confirmed_at_ms: timestampMs,
        confidence: confidenceResult.confidence,
        evidence: evaluation,
        evaluation_context: applicableDuringTemporalState
          ? "temporal_state"
          : "practice_step"
      };
      this.active.set(rule.id, occurrence);
      this.occurrences.push(occurrence);
      this.sequence += 1;
      events.push({
        id: `${Math.round(timestampMs)}:error:${this.sequence}`,
        type: "form_error_detected",
        timestamp_ms: timestampMs,
        ...occurrence
      });
    });

    return {
      active_errors: [...this.active.values()].map((error) => ({ ...error })),
      events
    };
  }

  getOccurrences() {
    return this.occurrences.map((occurrence) => ({ ...occurrence }));
  }
}
