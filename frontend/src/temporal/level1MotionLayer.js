const DEFAULT_CONFIG = {
  fpsWindow: 20,
  historyWindowMs: 1000,
  predictionHorizonMs: 100,
  smoothingAlpha: 0.62,
  positionErrorThreshold: 0.065,
  angleErrorThresholdDeg: 10,
  confidenceThreshold: 0.75,
  minFps: 20,
  predictionMatchToleranceMs: 70
};

export const LEVEL1_KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];

const ANGLE_MAP = {
  elbow_left: [11, 13, 15],
  elbow_right: [12, 14, 16],
  shoulder_left: [13, 11, 23],
  shoulder_right: [14, 12, 24],
  hip_left: [11, 23, 25],
  hip_right: [12, 24, 26],
  knee_left: [23, 25, 27],
  knee_right: [24, 26, 28],
  ankle_left: [25, 27, 31],
  ankle_right: [26, 28, 32],
  wrist_left: [13, 15, 19],
  wrist_right: [14, 16, 20]
};

function confidenceOf(point) {
  if (!point) return 0;
  if (Number.isFinite(point.visibility)) return point.visibility;
  if (Number.isFinite(point.presence)) return point.presence;
  return 1;
}

function clonePoint(point) {
  return {
    x: point?.x || 0,
    y: point?.y || 0,
    z: point?.z || 0,
    visibility: confidenceOf(point)
  };
}

function distance(first, second) {
  return Math.hypot(
    (first?.x || 0) - (second?.x || 0),
    (first?.y || 0) - (second?.y || 0),
    (first?.z || 0) - (second?.z || 0)
  );
}

function calculateAngle(a, b, c) {
  if (!a || !b || !c) return null;

  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const abLength = Math.hypot(ab.x, ab.y, ab.z);
  const cbLength = Math.hypot(cb.x, cb.y, cb.z);

  if (!abLength || !cbLength) return null;

  const cosine = Math.min(1, Math.max(-1, dot / (abLength * cbLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function createTransform(landmarks) {
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  const origin = leftHip && rightHip
    ? {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
        z: ((leftHip.z || 0) + (rightHip.z || 0)) / 2
      }
    : { x: 0.5, y: 0.5, z: 0 };

  const shoulderWidth = leftShoulder && rightShoulder
    ? distance(leftShoulder, rightShoulder)
    : 0;
  const torsoLength =
    leftShoulder && rightShoulder && leftHip && rightHip
      ? distance(
          {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2,
            z: ((leftShoulder.z || 0) + (rightShoulder.z || 0)) / 2
          },
          origin
        )
      : 0;
  const scale = Math.max(shoulderWidth, torsoLength, 0.001);

  return { origin, scale };
}

function normalizeLandmarks(landmarks, transform) {
  return landmarks.map((point) => ({
    x: ((point?.x || 0) - transform.origin.x) / transform.scale,
    y: ((point?.y || 0) - transform.origin.y) / transform.scale,
    z: ((point?.z || 0) - transform.origin.z) / transform.scale,
    visibility: confidenceOf(point)
  }));
}

function denormalizeLandmarks(landmarks, transform) {
  return landmarks.map((point) => ({
    x: transform.origin.x + point.x * transform.scale,
    y: transform.origin.y + point.y * transform.scale,
    z: transform.origin.z + (point.z || 0) * transform.scale,
    visibility: point.visibility
  }));
}

function calculateAngles(landmarks) {
  return Object.fromEntries(
    Object.entries(ANGLE_MAP)
      .map(([name, [a, b, c]]) => [name, calculateAngle(landmarks[a], landmarks[b], landmarks[c])])
      .filter(([, value]) => Number.isFinite(value))
  );
}

function calculateDerivative(current, previous, deltaSeconds) {
  if (!previous || deltaSeconds <= 0) {
    return current.map(() => ({ x: 0, y: 0, z: 0 }));
  }

  return current.map((point, index) => {
    const lastPoint = previous[index] || point;
    return {
      x: (point.x - lastPoint.x) / deltaSeconds,
      y: (point.y - lastPoint.y) / deltaSeconds,
      z: ((point.z || 0) - (lastPoint.z || 0)) / deltaSeconds
    };
  });
}

function smoothLandmarks(current, previous, alpha) {
  if (!previous || previous.length !== current.length) return current.map(clonePoint);

  return current.map((point, index) => ({
    x: previous[index].x * (1 - alpha) + point.x * alpha,
    y: previous[index].y * (1 - alpha) + point.y * alpha,
    z: (previous[index].z || 0) * (1 - alpha) + (point.z || 0) * alpha,
    visibility: confidenceOf(point)
  }));
}

function selectKeyed(values) {
  return Object.fromEntries(
    LEVEL1_KEY_JOINTS.map((index) => [index, values[index] || { x: 0, y: 0, z: 0 }])
  );
}

function compactLandmarks(landmarks) {
  return LEVEL1_KEY_JOINTS.map((index) => ({
    index,
    x: landmarks[index]?.x || 0,
    y: landmarks[index]?.y || 0,
    z: landmarks[index]?.z || 0,
    confidence: confidenceOf(landmarks[index])
  }));
}

export class Level1MotionLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frames = [];
    this.pendingPredictions = [];
    this.metricsHistory = [];
    this.frameIntervals = [];
    this.previousFrame = null;
    this.previousSmoothed = null;
  }

  update(rawLandmarks, timestampMs = performance.now()) {
    if (!rawLandmarks?.length) return null;

    const transform = createTransform(rawLandmarks);
    const normalized = normalizeLandmarks(rawLandmarks, transform);
    const smoothed = smoothLandmarks(
      normalized,
      this.previousSmoothed,
      this.config.smoothingAlpha
    );
    const deltaSeconds = this.previousFrame
      ? Math.max((timestampMs - this.previousFrame.timestamp) / 1000, 0.001)
      : 0;
    const velocity = calculateDerivative(smoothed, this.previousFrame?.normalized, deltaSeconds);
    const acceleration = calculateDerivative(velocity, this.previousFrame?.velocity, deltaSeconds);
    const predictedNormalized = smoothed.map((point, index) => ({
      x:
        point.x +
        velocity[index].x * (this.config.predictionHorizonMs / 1000) +
        0.5 * acceleration[index].x * (this.config.predictionHorizonMs / 1000) ** 2,
      y:
        point.y +
        velocity[index].y * (this.config.predictionHorizonMs / 1000) +
        0.5 * acceleration[index].y * (this.config.predictionHorizonMs / 1000) ** 2,
      z:
        (point.z || 0) +
        velocity[index].z * (this.config.predictionHorizonMs / 1000) +
        0.5 * acceleration[index].z * (this.config.predictionHorizonMs / 1000) ** 2,
      visibility: point.visibility
    }));
    const predictedLandmarks = denormalizeLandmarks(predictedNormalized, transform);
    const smoothedLandmarks = denormalizeLandmarks(smoothed, transform);
    const trackingConfidence = average(rawLandmarks.map(confidenceOf)) || 0;
    const angles = calculateAngles(smoothedLandmarks);
    const prediction = {
      timestamp: timestampMs,
      targetTimestamp: timestampMs + this.config.predictionHorizonMs,
      landmarks: predictedLandmarks,
      normalized: predictedNormalized,
      angles: calculateAngles(predictedLandmarks)
    };

    if (this.previousFrame) {
      this.frameIntervals.push(timestampMs - this.previousFrame.timestamp);
      this.frameIntervals = this.frameIntervals.slice(-this.config.fpsWindow);
    }

    const accuracy = this.measurePredictionAccuracy(timestampMs, smoothedLandmarks, angles);
    const fps = this.getFps();
    const readyForNextLayer =
      trackingConfidence >= this.config.confidenceThreshold &&
      fps >= this.config.minFps &&
      (!accuracy ||
        (
          accuracy.averageJointPositionError <= this.config.positionErrorThreshold &&
          (!Number.isFinite(accuracy.averageAngleError) ||
            accuracy.averageAngleError <= this.config.angleErrorThresholdDeg)
        ));

    const frameState = {
      timestamp: timestampMs,
      normalized,
      smoothed,
      velocity,
      acceleration,
      angles,
      transform,
      landmarks: smoothedLandmarks
    };

    this.frames.push(frameState);
    this.frames = this.frames.filter(
      (frame) => timestampMs - frame.timestamp <= this.config.historyWindowMs
    );
    this.pendingPredictions.push(prediction);
    this.pendingPredictions = this.pendingPredictions.filter(
      (item) => item.targetTimestamp >= timestampMs - this.config.predictionMatchToleranceMs
    );
    this.previousFrame = frameState;
    this.previousSmoothed = smoothed;

    return {
      timestamp: timestampMs / 1000,
      motion_context: {
        window_ms: this.config.historyWindowMs,
        prediction_horizon_ms: this.config.predictionHorizonMs,
        normalized_landmarks: compactLandmarks(smoothed),
        angles_deg: angles,
        velocity: selectKeyed(velocity),
        acceleration: selectKeyed(acceleration),
        predicted_landmarks: compactLandmarks(predictedLandmarks),
        prediction_confidence: this.getPredictionConfidence(accuracy, trackingConfidence)
      },
      tracking: {
        confidence: trackingConfidence,
        fps,
        frame_count: this.frames.length
      },
      debug: {
        currentLandmarks: smoothedLandmarks,
        predictedLandmarks,
        trailLandmarks: this.frames
          .filter((_, index) => index % 4 === 0)
          .slice(-8)
          .map((frame) => frame.landmarks),
        metrics: accuracy,
        metricsHistory: this.metricsHistory.slice(-80)
      },
      ready_for_next_layer: readyForNextLayer
    };
  }

  getFps() {
    const interval = average(this.frameIntervals);
    return interval ? Math.round(1000 / interval) : 0;
  }

  getPredictionConfidence(accuracy, trackingConfidence) {
    if (!accuracy) return trackingConfidence;

    const positionScore = Math.max(
      0,
      1 - accuracy.averageJointPositionError / this.config.positionErrorThreshold
    );
    const angleScore = Number.isFinite(accuracy.averageAngleError)
      ? Math.max(0, 1 - accuracy.averageAngleError / this.config.angleErrorThresholdDeg)
      : trackingConfidence;

    return Number(((trackingConfidence + positionScore + angleScore) / 3).toFixed(3));
  }

  measurePredictionAccuracy(timestampMs, actualLandmarks, actualAngles) {
    const matchIndex = this.pendingPredictions.findIndex(
      (prediction) =>
        Math.abs(prediction.targetTimestamp - timestampMs) <=
        this.config.predictionMatchToleranceMs
    );

    if (matchIndex === -1) {
      return this.metricsHistory[this.metricsHistory.length - 1] || null;
    }

    const [prediction] = this.pendingPredictions.splice(matchIndex, 1);
    const keyErrors = LEVEL1_KEY_JOINTS.map((index) =>
      distance(prediction.landmarks[index], actualLandmarks[index])
    );
    const angleErrors = Object.entries(actualAngles)
      .map(([name, actual]) => {
        const predicted = prediction.angles[name];
        return Number.isFinite(predicted) ? Math.abs(predicted - actual) : null;
      })
      .filter(Number.isFinite);
    const jointError = (index) => distance(prediction.landmarks[index], actualLandmarks[index]);
    const metrics = {
      timestamp: timestampMs / 1000,
      averageJointPositionError: average(keyErrors) || 0,
      averageAngleError: average(angleErrors),
      wristError: average([jointError(15), jointError(16)]) || 0,
      elbowError: average([jointError(13), jointError(14)]) || 0,
      kneeError: average([jointError(25), jointError(26)]) || 0
    };

    this.metricsHistory.push(metrics);
    this.metricsHistory = this.metricsHistory.slice(-180);

    return metrics;
  }
}
