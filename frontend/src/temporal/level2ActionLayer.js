import { StgatOnnxPredictor } from "./stgatOnnxPredictor";

const DEFAULT_CONFIG = {
  updateIntervalMs: 160,
  motionThreshold: 0.03,
  lowConfidenceThreshold: 0.62,
  stepReadyThreshold: 0.78,
  mistakeRiskThreshold: 0.45,
  trendWindow: 12,
  attentionPredictionHorizonMs: 500
};

const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
const SKELETON_EDGES = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28]
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function distance(first, second) {
  return Math.hypot(
    (first?.x || 0) - (second?.x || 0),
    (first?.y || 0) - (second?.y || 0),
    (first?.z || 0) - (second?.z || 0)
  );
}

function normalizeWeights(entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(entry.weight, 0), 0);

  if (!total) {
    return entries.map((entry) => ({ ...entry, weight: 0 }));
  }

  return entries.map((entry) => ({
    ...entry,
    weight: Number((Math.max(entry.weight, 0) / total).toFixed(4))
  }));
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

class SpatioTemporalGraphAttentionPredictor {
  predict({ level1State, actionContext, history, horizonMs }) {
    const currentLandmarks = level1State?.debug?.currentLandmarks;

    if (!currentLandmarks?.length) return null;

    const horizonSeconds = horizonMs / 1000;
    const velocity = level1State.motion_context?.velocity || {};
    const acceleration = level1State.motion_context?.acceleration || {};
    const mistakePart = actionContext.likely_mistake?.body_part || "";
    const targetParts = actionContext.targets || [];
    const spatialAttention = normalizeWeights(
      KEY_JOINTS.map((index) => {
        const pointVelocity = velocity[index] || { x: 0, y: 0, z: 0 };
        const pointAcceleration = acceleration[index] || { x: 0, y: 0, z: 0 };
        const isMistakeJoint = targetParts.some(
          (target) =>
            target.body_part === mistakePart &&
            target.body_part &&
            /wrist|elbow|knee|shoulder|hip|ankle/.test(target.body_part)
        );

        return {
          index,
          weight:
            Math.hypot(pointVelocity.x, pointVelocity.y, pointVelocity.z) +
            Math.hypot(pointAcceleration.x, pointAcceleration.y, pointAcceleration.z) * 0.12 +
            (isMistakeJoint ? actionContext.mistake_risk : 0)
        };
      })
    );
    const temporalAttention = normalizeWeights(
      [...history.slice(-10), { timestamp: level1State.timestamp, action_context: actionContext }]
        .slice(-10)
        .map((item, index) => ({
          index,
          timestamp: item.timestamp,
          weight: (item.action_context?.step_probability || actionContext.step_probability || 0) +
            (index + 1) * 0.08
        }))
    );
    const graphAttention = normalizeWeights(
      SKELETON_EDGES.map(([from, to]) => {
        const fromVelocity = velocity[from] || { x: 0, y: 0, z: 0 };
        const toVelocity = velocity[to] || { x: 0, y: 0, z: 0 };

        return {
          edge: [from, to],
          weight:
            Math.hypot(fromVelocity.x, fromVelocity.y, fromVelocity.z) +
            Math.hypot(toVelocity.x, toVelocity.y, toVelocity.z)
        };
      })
    );
    const predictedReference = level1State.debug?.predictedLandmarks;
    const crossAttention = normalizeWeights(
      KEY_JOINTS.map((index) => ({
        index,
        weight: predictedReference?.[index]
          ? distance(currentLandmarks[index], predictedReference[index]) +
            (1 - actionContext.step_probability)
          : 1 - actionContext.step_probability
      }))
    );
    const spatialWeightByJoint = new Map(spatialAttention.map((entry) => [entry.index, entry.weight]));
    const graphWeightByJoint = new Map();

    graphAttention.forEach(({ edge, weight }) => {
      edge.forEach((index) => {
        graphWeightByJoint.set(index, (graphWeightByJoint.get(index) || 0) + weight);
      });
    });

    const landmarks = currentLandmarks.map((point, index) => {
      const pointVelocity = velocity[index] || { x: 0, y: 0, z: 0 };
      const pointAcceleration = acceleration[index] || { x: 0, y: 0, z: 0 };
      const attentionBoost = clamp(
        1 +
          (spatialWeightByJoint.get(index) || 0) * 1.2 +
          (graphWeightByJoint.get(index) || 0) * 0.65,
        1,
        1.85
      );

      return {
        x:
          point.x +
          pointVelocity.x * horizonSeconds * attentionBoost +
          0.5 * pointAcceleration.x * horizonSeconds ** 2,
        y:
          point.y +
          pointVelocity.y * horizonSeconds * attentionBoost +
          0.5 * pointAcceleration.y * horizonSeconds ** 2,
        z:
          (point.z || 0) +
          pointVelocity.z * horizonSeconds * attentionBoost +
          0.5 * pointAcceleration.z * horizonSeconds ** 2,
        visibility: point.visibility
      };
    });

    return {
      model_name: "Level 2 Heuristic Predictor",
      display_name: "Physics + Attention Fallback",
      status: "level_2_heuristic_interface_ready",
      prediction_horizon_ms: horizonMs,
      landmarks,
      attention: {
        spatial: spatialAttention,
        temporal: temporalAttention,
        graph: graphAttention,
        cross: crossAttention
      }
    };
  }
}

export class Level2ActionLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastUpdateMs = 0;
    this.lastMotionEnergy = 0;
    this.history = [];
    this.motionFrames = [];
    this.previousStepId = null;
    this.attentionPredictor = new SpatioTemporalGraphAttentionPredictor();
    this.onnxPredictor = new StgatOnnxPredictor();
    this.onnxPredictor.load();
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
    const attentionPrediction = this.attentionPredictor.predict({
      level1State,
      actionContext,
      history: this.history,
      horizonMs: this.config.attentionPredictionHorizonMs
    });
    const onnxPrediction = this.onnxPredictor.update({
      frames: this.motionFrames,
      currentLandmarks: level1State.debug?.currentLandmarks || [],
      actionContext: {
        ...actionContext,
        attention_prediction_horizon_ms: this.config.attentionPredictionHorizonMs
      }
    });
    const modelPrediction = onnxPrediction?.landmarks ? onnxPrediction : attentionPrediction;
    const actionState = {
      timestamp: level1State.timestamp,
      action_context: {
        ...actionContext,
        attention_prediction: {
          model_name: modelPrediction?.model_name,
          display_name: modelPrediction?.display_name,
          status: modelPrediction?.status,
          source: modelPrediction?.source || "heuristic_fallback",
          error: modelPrediction?.error || null,
          onnx_status: onnxPrediction?.status || this.onnxPredictor.status,
          onnx_error: onnxPrediction?.error || null,
          input_names: modelPrediction?.input_names || [],
          output_names: modelPrediction?.output_names || [],
          output_dims: modelPrediction?.output_dims || [],
          prediction_horizon_ms:
            modelPrediction?.prediction_horizon_ms || attentionPrediction?.prediction_horizon_ms,
          spatial_attention: attentionPrediction?.attention?.spatial || [],
          temporal_attention: attentionPrediction?.attention?.temporal || [],
          graph_attention: attentionPrediction?.attention?.graph || [],
          cross_attention: attentionPrediction?.attention?.cross || []
        }
      },
      ready_for_situation_awareness:
        level1State.ready_for_next_layer &&
        !confidenceLow &&
        predictionConfidence >= this.config.lowConfidenceThreshold,
      debug: {
        attentionPredictedLandmarks: modelPrediction?.landmarks || null,
        onnxPredictedLandmarks: onnxPrediction?.landmarks || null,
        heuristicPredictedLandmarks: attentionPrediction?.landmarks || null,
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
