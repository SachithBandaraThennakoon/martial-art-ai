const DEFAULT_CONFIG = {
  targetToleranceMs: 18,
  retentionMs: 1400,
  lowObservationConfidence: 0.55
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function confidenceOf(point) {
  if (Number.isFinite(point?.visibility)) return point.visibility;
  if (Number.isFinite(point?.presence)) return point.presence;
  return 1;
}

function predictionWeight(model, horizonFrame, confidence) {
  const modelWeight = model === "level1" ? 1.15 : 0.9;
  const horizonWeight = 1 / (1 + Math.max(0, horizonFrame - 1) * 0.09);
  return modelWeight * horizonWeight * clamp(confidence, 0.05, 1);
}

function observationWeight(confidence) {
  if (confidence >= 0.75) return confidence * 3;
  if (confidence >= 0.55) return confidence * 1.5;
  return confidence * 0.25;
}

function aggregateLandmarks(observedLandmarks, observedConfidence, forecasts) {
  const jointCount = Math.max(
    observedLandmarks?.length || 0,
    ...forecasts.map((forecast) => forecast.landmarks?.length || 0)
  );
  const observedWeight = observationWeight(observedConfidence);

  return Array.from({ length: jointCount }, (_, jointIndex) => {
    const observed = observedLandmarks?.[jointIndex];
    const samples = forecasts
      .map((forecast) => ({
        point: forecast.landmarks?.[jointIndex],
        weight: predictionWeight(
          forecast.model,
          forecast.horizonFrame,
          forecast.confidence
        )
      }))
      .filter(({ point }) => Number.isFinite(point?.x) && Number.isFinite(point?.y));

    if (Number.isFinite(observed?.x) && Number.isFinite(observed?.y)) {
      samples.push({ point: observed, weight: observedWeight });
    }
    if (!samples.length) return observed ? { ...observed } : null;

    const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
    const weighted = (axis) =>
      samples.reduce(
        (total, sample) => total + (sample.point?.[axis] || 0) * sample.weight,
        0
      ) / Math.max(totalWeight, 0.0001);

    return {
      x: weighted("x"),
      y: weighted("y"),
      z: weighted("z"),
      visibility:
        samples.reduce(
          (total, sample) => total + confidenceOf(sample.point) * sample.weight,
          0
        ) / Math.max(totalWeight, 0.0001)
    };
  });
}

function averagePoseDistance(first, second) {
  const distances = (first || [])
    .map((point, index) => {
      const other = second?.[index];
      if (
        !Number.isFinite(point?.x) ||
        !Number.isFinite(point?.y) ||
        !Number.isFinite(other?.x) ||
        !Number.isFinite(other?.y)
      ) {
        return null;
      }
      return Math.hypot(
        point.x - other.x,
        point.y - other.y,
        (point.z || 0) - (other.z || 0)
      );
    })
    .filter(Number.isFinite);

  if (!distances.length) return null;
  return distances.reduce((total, value) => total + value, 0) / distances.length;
}

export class PredictionLedger {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.forecasts = new Map();
  }

  reset() {
    this.forecasts.clear();
  }

  addForecast({
    model,
    originTimestampMs,
    targetTimestampMs,
    horizonFrame,
    landmarks,
    confidence = 1
  }) {
    if (
      !model ||
      !Number.isFinite(originTimestampMs) ||
      !Number.isFinite(targetTimestampMs) ||
      !Number.isFinite(horizonFrame) ||
      !landmarks?.length
    ) {
      return;
    }

    const key = [
      model,
      Math.round(originTimestampMs * 10),
      Math.round(targetTimestampMs * 10),
      horizonFrame
    ].join(":");
    this.forecasts.set(key, {
      model,
      originTimestampMs,
      targetTimestampMs,
      horizonFrame,
      landmarks,
      confidence: clamp(Number(confidence) || 0, 0, 1)
    });
  }

  addSequence({ model, originTimestampMs, forecasts = [], confidence = 1 }) {
    forecasts.forEach((forecast) => {
      this.addForecast({
        model,
        originTimestampMs,
        targetTimestampMs:
          forecast.targetTimestampMs ?? forecast.target_timestamp_ms,
        horizonFrame: forecast.horizonFrame ?? forecast.horizon_frame,
        landmarks: forecast.landmarks,
        confidence
      });
    });
  }

  resolve({
    targetTimestampMs,
    observedLandmarks = [],
    observedConfidence = 1
  }) {
    const tolerance = this.config.targetToleranceMs;
    const matched = [...this.forecasts.values()].filter(
      (forecast) =>
        Math.abs(forecast.targetTimestampMs - targetTimestampMs) <= tolerance
    );
    const aggregate = aggregateLandmarks(
      observedLandmarks,
      observedConfidence,
      matched
    );
    const predictedOnlyAggregate = aggregateLandmarks([], 0, matched);
    const agreementError = matched.length
      ? averagePoseDistance(predictedOnlyAggregate, observedLandmarks)
      : null;
    const level1Count = matched.filter(
      (forecast) => forecast.model === "level1"
    ).length;
    const level2Count = matched.filter(
      (forecast) => forecast.model === "level2"
    ).length;
    const predictionConfidence = matched.length
      ? matched.reduce((total, forecast) => total + forecast.confidence, 0) /
        matched.length
      : 0;

    for (const [key, forecast] of this.forecasts) {
      if (
        forecast.targetTimestampMs <= targetTimestampMs + tolerance ||
        forecast.targetTimestampMs <
          targetTimestampMs - this.config.retentionMs
      ) {
        this.forecasts.delete(key);
      }
    }

    return {
      targetTimestampMs,
      observedLandmarks,
      aggregateLandmarks: aggregate,
      predictedLandmarks: predictedOnlyAggregate,
      sourceCounts: {
        observed: observedLandmarks.length ? 1 : 0,
        level1: level1Count,
        level2: level2Count,
        total: (observedLandmarks.length ? 1 : 0) + matched.length
      },
      predictionConfidence: Number(predictionConfidence.toFixed(3)),
      observedConfidence: Number(clamp(observedConfidence, 0, 1).toFixed(3)),
      agreementError: Number.isFinite(agreementError)
        ? Number(agreementError.toFixed(5))
        : null,
      usePredictionFallback:
        observedConfidence < this.config.lowObservationConfidence &&
        matched.length > 0,
      forecasts: matched.map((forecast) => ({
        model: forecast.model,
        originTimestampMs: forecast.originTimestampMs,
        targetTimestampMs: forecast.targetTimestampMs,
        horizonFrame: forecast.horizonFrame,
        confidence: forecast.confidence
      }))
    };
  }
}

export function selectPredictionAwareDisplayPose(
  aggregate,
  {
    mediumConfidenceThreshold = 0.72,
    maximumBlendError = 0.06
  } = {}
) {
  const observed = aggregate?.observedLandmarks || [];
  const combined = aggregate?.aggregateLandmarks || [];
  const predicted = aggregate?.predictedLandmarks || [];
  const predictionCount =
    (aggregate?.sourceCounts?.level1 || 0) +
    (aggregate?.sourceCounts?.level2 || 0);

  if (!predictionCount || !predicted.length) {
    return {
      landmarks: observed,
      source: "observed",
      predictionCount: 0
    };
  }

  if (aggregate.usePredictionFallback) {
    return {
      landmarks: predicted,
      source: "prediction_fallback",
      predictionCount
    };
  }

  if (
    aggregate.observedConfidence < mediumConfidenceThreshold &&
    combined.length &&
    Number.isFinite(aggregate.agreementError) &&
    aggregate.agreementError <= maximumBlendError
  ) {
    return {
      landmarks: combined,
      source: "confidence_blend",
      predictionCount
    };
  }

  return {
    landmarks: observed,
    source: "observed",
    predictionCount
  };
}
