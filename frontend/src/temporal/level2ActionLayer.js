import { StgatOnnxPredictor } from "./stgatOnnxPredictor";

const DEFAULT_CONFIG = {
  updateIntervalMs: 160,
  motionThreshold: 0.03,
  lowConfidenceThreshold: 0.62,
  stepReadyThreshold: 0.78,
  mistakeRiskThreshold: 0.45,
  trendWindow: 12,
  attentionPredictionHorizonMs: 500,
  onnxEnabled: false,
  onnxIntervalMs: 900
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function formatPartName(bodyPart) {
  return bodyPart ? bodyPart.replace(/_/g, " ") : null;
}

function getTargetValue(target) {
  if (!target) return null;
  if (Number.isFinite(target.min) && Number.isFinite(target.max)) {
    return (target.min + target.max) / 2;
  }
  if (Number.isFinite(target.min_angle) && Number.isFinite(target.max_angle)) {
    return (target.min_angle + target.max_angle) / 2;
  }
  return null;
}

function getTargetMin(target) {
  return Number.isFinite(target?.min) ? target.min : target?.min_angle;
}

function getTargetMax(target) {
  return Number.isFinite(target?.max) ? target.max : target?.max_angle;
}

function scoreAngle(value, target) {
  const min = getTargetMin(target);
  const max = getTargetMax(target);

  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return { score: 0, error: null, issue: "missing" };
  }

  if (value >= min && value <= max) {
    return { score: 1, error: 0, issue: "good" };
  }

  const targetValue = getTargetValue(target);
  const error = Math.abs(value - targetValue);
  const tolerance = Math.max((max - min) / 2, 6);
  const score = clamp(1 - error / (tolerance * 3), 0, 1);
  const issue = value < min ? "too_closed" : "too_open";

  return { score, error, issue };
}

function getMotionEnergy(motionContext = {}) {
  const velocityValues = Object.values(motionContext.velocity || {});
  const jointSpeeds = velocityValues.map((point) =>
    Math.hypot(point?.x || 0, point?.y || 0, point?.z || 0)
  );

  return average(jointSpeeds) || 0;
}

function getTrend(values) {
  if (values.length < 4) return "warming";

  const first = average(values.slice(0, Math.floor(values.length / 2))) || 0;
  const second = average(values.slice(Math.floor(values.length / 2))) || 0;
  const delta = second - first;

  if (delta > 0.04) return "improving";
  if (delta < -0.04) return "dropping";
  return "stable";
}

export class Level2ActionLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastUpdateMs = 0;
    this.lastMotionEnergy = 0;
    this.history = [];
    this.motionFrames = [];
    this.previousStepId = null;
    this.lastOnnxUpdateMs = 0;
    this.onnxPredictor = new StgatOnnxPredictor();
  }

  update({
    level1State,
    requiredParts = [],
    currentStepId = null,
    currentStepName = "",
    techniqueName = ""
  }) {
    if (!level1State?.motion_context) return null;

    const timestampMs = level1State.timestamp * 1000;
    const motionEnergy = getMotionEnergy(level1State.motion_context);
    this.motionFrames.push({
      timestamp: level1State.timestamp,
      landmarks: level1State.debug?.currentLandmarks || [],
      velocity: level1State.motion_context?.velocity || {},
      acceleration: level1State.motion_context?.acceleration || {}
    });
    this.motionFrames = this.motionFrames.slice(-70);
    const motionChanged =
      Math.abs(motionEnergy - this.lastMotionEnergy) >= this.config.motionThreshold;
    const dueForUpdate = timestampMs - this.lastUpdateMs >= this.config.updateIntervalMs;
    const stepChanged = currentStepId !== this.previousStepId;
    const confidenceLow =
      (level1State.tracking?.confidence || 0) < this.config.lowConfidenceThreshold;

    if (!dueForUpdate && !motionChanged && !stepChanged) {
      return this.history[this.history.length - 1] || null;
    }

    this.lastUpdateMs = timestampMs;
    this.lastMotionEnergy = motionEnergy;
    this.previousStepId = currentStepId;

    const angles = level1State.motion_context.angles_deg || {};
    const targetScores = requiredParts
      .filter((part) => Number.isFinite(getTargetMin(part)) && Number.isFinite(getTargetMax(part)))
      .map((part) => {
        const bodyPart = part.body_part;
        const value = angles[bodyPart];
        const result = scoreAngle(value, part);

        return {
          body_part: bodyPart,
          value: Number.isFinite(value) ? value : null,
          score: result.score,
          error: result.error,
          issue: result.issue,
          target_min: getTargetMin(part),
          target_max: getTargetMax(part)
        };
      });
    const knownScores = targetScores.filter((target) => target.issue !== "missing");
    const stepProbability = average(knownScores.map((target) => target.score)) || 0;
    const missingRatio = targetScores.length
      ? (targetScores.length - knownScores.length) / targetScores.length
      : 1;
    const worstTarget = targetScores
      .filter((target) => target.issue !== "good")
      .sort((first, second) => (first.score || 0) - (second.score || 0))[0];
    const mistakeRisk = clamp(
      (1 - stepProbability) * 0.72 +
        missingRatio * 0.18 +
        (confidenceLow ? 0.1 : 0),
      0,
      1
    );
    const techniqueProbability = requiredParts.length ? stepProbability : 0;
    const predictionConfidence = clamp(
      (
        (level1State.motion_context.prediction_confidence || 0) +
        (level1State.tracking?.confidence || 0) +
        stepProbability
      ) / 3,
      0,
      1
    );
    const stepState =
      stepProbability >= this.config.stepReadyThreshold
        ? "matched"
        : motionEnergy > this.config.motionThreshold
          ? "in_progress"
          : "waiting";
    const nextStepPrediction =
      stepState === "matched" && mistakeRisk < this.config.mistakeRiskThreshold
        ? "ready_for_next_step"
        : "hold_current_step";

    const historyScores = [...this.history.map((item) => item.action_context.step_probability), stepProbability]
      .slice(-this.config.trendWindow);
    const actionContext = {
      window_ms: 5000,
      update_rate: "event_or_5_10_fps",
      technique_name: techniqueName || null,
      current_step_id: currentStepId,
      current_step_name: currentStepName || null,
      technique_probability: Number(techniqueProbability.toFixed(3)),
      step_probability: Number(stepProbability.toFixed(3)),
      step_state: stepState,
      step_progress: Number(clamp(stepProbability, 0, 1).toFixed(3)),
      mistake_risk: Number(mistakeRisk.toFixed(3)),
      likely_mistake: worstTarget
        ? {
            body_part: worstTarget.body_part,
            label: formatPartName(worstTarget.body_part),
            issue: worstTarget.issue,
            error: worstTarget.error
          }
        : null,
      next_step_prediction: nextStepPrediction,
      prediction_confidence: Number(predictionConfidence.toFixed(3)),
      temporal_trend: getTrend(historyScores),
      motion_energy: Number(motionEnergy.toFixed(4)),
      targets: targetScores
    };
    const shouldUpdateOnnx =
      this.config.onnxEnabled &&
      timestampMs - this.lastOnnxUpdateMs >= this.config.onnxIntervalMs;
    const onnxPrediction = shouldUpdateOnnx
      ? this.onnxPredictor.update({
          frames: this.motionFrames,
          currentLandmarks: level1State.debug?.currentLandmarks || [],
          actionContext: {
            ...actionContext,
            attention_prediction_horizon_ms: this.config.attentionPredictionHorizonMs
          }
        })
      : this.onnxPredictor.latestPrediction;

    if (shouldUpdateOnnx) {
      this.lastOnnxUpdateMs = timestampMs;
    }
    const modelPrediction = onnxPrediction?.landmarks ? onnxPrediction : null;
    const actionState = {
      timestamp: level1State.timestamp,
      action_context: {
        ...actionContext,
        attention_prediction: {
          model_name: modelPrediction?.model_name,
          display_name: modelPrediction?.display_name,
          status: modelPrediction?.status,
          source: modelPrediction?.source || "none",
          error: modelPrediction?.error || null,
          onnx_status: onnxPrediction?.status || this.onnxPredictor.status,
          onnx_error: onnxPrediction?.error || null,
          input_names: modelPrediction?.input_names || [],
          output_names: modelPrediction?.output_names || [],
          output_dims: modelPrediction?.output_dims || [],
          prediction_horizon_ms:
            modelPrediction?.prediction_horizon_ms || this.config.attentionPredictionHorizonMs,
          spatial_attention: [],
          temporal_attention: [],
          graph_attention: [],
          cross_attention: []
        }
      },
      ready_for_situation_awareness:
        level1State.ready_for_next_layer &&
        !confidenceLow &&
        predictionConfidence >= this.config.lowConfidenceThreshold,
      debug: {
        onnxPredictedLandmarks: onnxPrediction?.landmarks || null,
        onnxPrediction,
        history: this.history.slice(-40).map((item) => ({
          timestamp: item.timestamp,
          step_probability: item.action_context.step_probability,
          mistake_risk: item.action_context.mistake_risk,
          prediction_confidence: item.action_context.prediction_confidence
        })),
        motionChanged,
        confidenceLow
      }
    };

    this.history.push(actionState);
    this.history = this.history.slice(-80);

    return actionState;
  }
}
