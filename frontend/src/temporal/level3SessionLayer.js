import { RepetitionSessionLedger } from "./repetitionSessionLedger.js";

const DEFAULT_CONFIG = {
  updateIntervalMs: 500,
  windowSize: 36,
  minSamplesForDecision: 6,
  readyThreshold: 0.72,
  fatigueRiskThreshold: 0.62,
  repeatedMistakeMinCount: 3
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function variance(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length < 2) return 0;
  const mean = average(finiteValues);
  return average(finiteValues.map((value) => (value - mean) ** 2));
}

function getTrend(values, tolerance = 0.04) {
  if (values.length < 6) return "warming_up";

  const splitIndex = Math.floor(values.length / 2);
  const first = average(values.slice(0, splitIndex));
  const second = average(values.slice(splitIndex));
  const delta = second - first;

  if (delta > tolerance) return "improving";
  if (delta < -tolerance) return "dropping";
  return "stable";
}

function formatMistake(mistake) {
  if (!mistake?.body_part && !mistake?.label) return null;

  return `${mistake.label || mistake.body_part}:${mistake.issue || "issue"}`;
}

function getMostFrequentMistake(items, minCount) {
  const counts = new Map();

  items.forEach((item) => {
    const key = formatMistake(item.action?.likely_mistake);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const [key, count] = [...counts.entries()].sort((first, second) => second[1] - first[1])[0] || [];

  if (!key || count < minCount) return null;

  const [bodyPart, issue] = key.split(":");
  return {
    body_part: bodyPart,
    issue,
    count
  };
}

function getRecommendation({
  masteryScore,
  consistencyScore,
  fatigueRisk,
  repeatedMistake,
  trend,
  readyThreshold,
  fatigueRiskThreshold,
  hasEnoughSamples
}) {
  if (!hasEnoughSamples) return "collecting";
  if (fatigueRisk > fatigueRiskThreshold) return "slow_down";
  if (repeatedMistake) return "repeat_step";
  if (masteryScore >= readyThreshold && consistencyScore >= 0.68 && trend !== "dropping") {
    return "advance_step";
  }
  if (trend === "dropping") return "reset_form";
  return "continue";
}

function getSessionState({ masteryScore, fatigueRisk, trend, recommendation, fatigueRiskThreshold }) {
  if (recommendation === "collecting") return "warming_up";
  if (fatigueRisk > fatigueRiskThreshold) return "fatigue_watch";
  if (recommendation === "advance_step") return "ready_next";
  if (trend === "warming_up") return "warming_up";
  if (trend === "improving") return "learning";
  if (masteryScore >= 0.65) return "stable";
  return "building";
}

function getCoachMessage({ recommendation, repeatedMistake, masteryScore }) {
  if (recommendation === "collecting") return "Keep moving. Building a reliable session trend.";
  if (recommendation === "advance_step") return "Form is consistent. Ready for the next step.";
  if (recommendation === "slow_down") return "Motion quality is dropping. Slow down and reset breathing.";
  if (recommendation === "repeat_step" && repeatedMistake) {
    return `Repeat this step. ${repeatedMistake.body_part.replace(/_/g, " ")} is still ${repeatedMistake.issue.replace(/_/g, " ")}.`;
  }
  if (recommendation === "reset_form") return "Reset the stance and rebuild the movement slowly.";
  if (masteryScore < 0.35) return "Keep the current step. Build a cleaner base before advancing.";
  return "Continue. The session trend is being tracked.";
}

export class Level3SessionLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.history = [];
    this.lastUpdateMs = null;
    this.latestState = null;
    this.sessionKey = null;
    this.events = [];
    this.seenEventIds = new Set();
    this.repetitionLedger = new RepetitionSessionLedger(config.repetitionLedger);
  }

  reset() {
    this.history = [];
    this.lastUpdateMs = null;
    this.latestState = null;
    this.sessionKey = null;
    this.events = [];
    this.seenEventIds = new Set();
    this.repetitionLedger.reset();
  }

  recordCue({ cue, timestampMs }) {
    return this.repetitionLedger.recordCue({ cue, timestampMs });
  }

  endSession(timestampMs) {
    return this.repetitionLedger.endSession(timestampMs);
  }

  update({ level1State, level2State, techniqueName = "", currentStepName = "" }) {
    if (!level1State || !level2State?.action_context) return this.latestState;

    const timestampMs = level1State.timestamp * 1000;
    if (!Number.isFinite(timestampMs)) return this.latestState;

    const nextSessionKey = String(techniqueName || level2State.action_context.technique_name || "")
      .trim()
      .toLowerCase();
    if (this.sessionKey !== null && nextSessionKey !== this.sessionKey) {
      this.reset();
    }
    this.sessionKey = nextSessionKey;

    const action = level2State.action_context;
    const segmentationEvent = action.temporal_segmentation?.event;
    if (segmentationEvent?.id && !this.seenEventIds.has(segmentationEvent.id)) {
      this.seenEventIds.add(segmentationEvent.id);
      this.events.push(segmentationEvent);
      this.events = this.events.slice(-100);
    }
    const repetitionSummary = this.repetitionLedger.observe({
      timestampMs,
      event: segmentationEvent,
      phase: action.temporal_segmentation?.motion_phase,
      stepId: action.current_step_id,
      stepName: currentStepName || action.current_step_name,
      stepProbability: action.step_probability,
      mistakeRisk: action.mistake_risk,
      trackingConfidence: level1State.tracking?.confidence,
      techniqueName: techniqueName || action.technique_name
    });

    if (
      this.lastUpdateMs !== null &&
      timestampMs >= this.lastUpdateMs &&
      timestampMs - this.lastUpdateMs < this.config.updateIntervalMs
    ) {
      return this.latestState;
    }

    this.lastUpdateMs = timestampMs;

    this.history.push({
      timestamp: level1State.timestamp,
      action,
      trackingConfidence: level1State.tracking?.confidence || 0,
      motionEnergy: action.motion_energy || 0
    });
    this.history = this.history.slice(-this.config.windowSize);

    const window = this.history;
    const stepScores = window.map((item) => item.action.step_probability);
    const mistakeRisks = window.map((item) => item.action.mistake_risk);
    const motionEnergy = window.map((item) => item.motionEnergy);
    const trackingScores = window.map((item) => item.trackingConfidence);
    const masteryScore = clamp(average(stepScores), 0, 1);
    const consistencyScore = clamp(1 - variance(stepScores) * 6, 0, 1);
    const fatigueRisk = clamp(
      average(mistakeRisks) * 0.45 +
        Math.max(0, average(motionEnergy.slice(-8)) - average(motionEnergy.slice(0, -8))) * 4 +
        (getTrend(stepScores) === "dropping" ? 0.22 : 0),
      0,
      1
    );
    const repeatedMistake = getMostFrequentMistake(window, this.config.repeatedMistakeMinCount);
    const trend = getTrend(stepScores);
    const hasEnoughSamples = window.length >= this.config.minSamplesForDecision;
    const recommendation = getRecommendation({
      masteryScore,
      consistencyScore,
      fatigueRisk,
      repeatedMistake,
      trend,
      readyThreshold: this.config.readyThreshold,
      fatigueRiskThreshold: this.config.fatigueRiskThreshold,
      hasEnoughSamples
    });
    const sessionState = getSessionState({
      masteryScore,
      fatigueRisk,
      trend,
      recommendation,
      fatigueRiskThreshold: this.config.fatigueRiskThreshold
    });

    this.latestState = {
      timestamp: level1State.timestamp,
      session_context: {
        technique_name: techniqueName || null,
        current_step_name: currentStepName || null,
        session_state: sessionState,
        mastery_score: Number(masteryScore.toFixed(3)),
        consistency_score: Number(consistencyScore.toFixed(3)),
        fatigue_risk: Number(fatigueRisk.toFixed(3)),
        repeated_mistake: repeatedMistake,
        recommendation,
        coach_message: getCoachMessage({ recommendation, repeatedMistake, masteryScore }),
        trend,
        temporal_phase: action.temporal_segmentation?.motion_phase || null,
        latest_event: this.events[this.events.length - 1] || null,
        event_counts: this.events.reduce((counts, event) => ({
          ...counts,
          [event.type]: (counts[event.type] || 0) + 1
        }), {}),
        repetition_summary: repetitionSummary,
        ready_for_level_4:
          hasEnoughSamples &&
          recommendation === "advance_step" &&
          masteryScore >= this.config.readyThreshold &&
          consistencyScore >= 0.68
      },
      debug: {
        samples: window.length,
        minimum_samples: this.config.minSamplesForDecision,
        average_tracking: Number(average(trackingScores).toFixed(3)),
        average_mistake_risk: Number(average(mistakeRisks).toFixed(3)),
        recent_step_scores: stepScores.slice(-12).map((value) => Number((value || 0).toFixed(3)))
      }
    };

    return this.latestState;
  }
}
