import * as ort from "onnxruntime-web/wasm";

const MODEL_PATH = "/models/stgat_motion_predictor.onnx?v=mediapipe33-opset18";
const DEFAULT_SEQUENCE_LENGTH = 60;
const DEFAULT_FUTURE_LENGTH = 15;
const DEFAULT_JOINT_COUNT = 33;
const DEFAULT_CHANNEL_COUNT = 3;
const BODY_ANCHOR_JOINTS = [11, 12, 23, 24];
const BODY_SCALE_EDGES = [
  [11, 12],
  [23, 24],
  [11, 23],
  [12, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28]
];
const MODEL_INPUT_SHAPE = [1, DEFAULT_SEQUENCE_LENGTH, DEFAULT_JOINT_COUNT, DEFAULT_CHANNEL_COUNT];
const MEDIAPIPE_JOINT_MAP = [
  { type: "center", joints: [23, 24] },
  { type: "single", joint: 24 },
  { type: "single", joint: 26 },
  { type: "single", joint: 28 },
  { type: "single", joint: 23 },
  { type: "single", joint: 25 },
  { type: "single", joint: 27 },
  { type: "center", joints: [11, 12, 23, 24] },
  { type: "center", joints: [11, 12] },
  { type: "single", joint: 0 },
  { type: "single", joint: 11 },
  { type: "single", joint: 13 },
  { type: "single", joint: 15 },
  { type: "single", joint: 12 },
  { type: "single", joint: 14 },
  { type: "single", joint: 16 },
  { type: "single", joint: 0 }
];
const MODEL_TO_MEDIAPIPE = [null, 24, 26, 28, 23, 25, 27, null, null, 0, 11, 13, 15, 12, 14, 16, null];
const MAX_VISUAL_JOINT_DELTA = 0.28;

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
  wasm: "/ort-wasm/ort-wasm-simd-threaded.wasm"
};

function resolveDim(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getInputShape(session) {
  const inputName = session.inputNames[0];
  const metadata = session.inputMetadata?.[inputName];
  const dimensions = metadata?.dimensions || metadata?.dims || [];

  if (dimensions.length >= 4) {
    return {
      inputName,
      dimensions: [
        resolveDim(dimensions[0], MODEL_INPUT_SHAPE[0]),
        resolveDim(dimensions[1], MODEL_INPUT_SHAPE[1]),
        resolveDim(dimensions[2], MODEL_INPUT_SHAPE[2]),
        resolveDim(dimensions[3], MODEL_INPUT_SHAPE[3])
      ],
      layout: "btvc"
    };
  }

  return {
    inputName,
    dimensions: MODEL_INPUT_SHAPE.slice(),
    layout: "btvc"
  };
}

function getPointChannel(point, channel) {
  if (channel === 0) return point?.x || 0;
  if (channel === 1) return point?.y || 0;
  if (channel === 2) return point?.z || 0;
  return 0;
}

function averagePoint(points) {
  const validPoints = points.filter(Boolean);
  if (!validPoints.length) return { x: 0, y: 0, z: 0, visibility: 0 };

  return {
    x: validPoints.reduce((total, point) => total + (point.x || 0), 0) / validPoints.length,
    y: validPoints.reduce((total, point) => total + (point.y || 0), 0) / validPoints.length,
    z: validPoints.reduce((total, point) => total + (point.z || 0), 0) / validPoints.length,
    visibility:
      validPoints.reduce((total, point) => total + (point.visibility ?? 1), 0) /
      validPoints.length
  };
}

function getMappedPoint(landmarks, mapping) {
  if (!landmarks?.length || !mapping) return { x: 0, y: 0, z: 0, visibility: 0 };

  if (mapping.type === "single") {
    return landmarks[mapping.joint] || { x: 0, y: 0, z: 0, visibility: 0 };
  }

  return averagePoint(mapping.joints.map((index) => landmarks[index]));
}

function normalizeMediaPipeFrame(landmarks) {
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const root = leftHip && rightHip
    ? averagePoint([leftHip, rightHip])
    : { x: 0.5, y: 0.5, z: 0 };
  const shoulderScale = leftShoulder && rightShoulder
    ? Math.hypot(
        (leftShoulder.x || 0) - (rightShoulder.x || 0),
        (leftShoulder.y || 0) - (rightShoulder.y || 0),
        (leftShoulder.z || 0) - (rightShoulder.z || 0)
      )
    : 0;
  const torsoScale = leftShoulder && rightShoulder && leftHip && rightHip
    ? Math.hypot(
        ((leftShoulder.x + rightShoulder.x) / 2) - root.x,
        ((leftShoulder.y + rightShoulder.y) / 2) - root.y,
        (((leftShoulder.z || 0) + (rightShoulder.z || 0)) / 2) - (root.z || 0)
      )
    : 0;
  const scale = Math.max(shoulderScale, torsoScale, 0.001);

  return {
    root,
    scale,
    points: Array.from({ length: 33 }, (_, index) => {
      const point = landmarks[index] || { x: root.x, y: root.y, z: root.z, visibility: 0 };

      return {
        x: ((point.x || 0) - root.x) / scale,
        y: ((point.y || 0) - root.y) / scale,
        z: ((point.z || 0) - (root.z || 0)) / scale,
        visibility: point.visibility
      };
    })
  };
}

function toModelFrame(frame, jointCount = DEFAULT_JOINT_COUNT) {
  const landmarks = frame?.landmarks || [];

  if (jointCount === 33) {
    return normalizeMediaPipeFrame(landmarks);
  }

  const modelPoints = MEDIAPIPE_JOINT_MAP.map((mapping) => getMappedPoint(landmarks, mapping));
  const root = modelPoints[0] || { x: 0, y: 0, z: 0 };
  const scalePoint = modelPoints[8] || root;
  const scale = Math.max(
    Math.hypot(
      (scalePoint.x || 0) - (root.x || 0),
      (scalePoint.y || 0) - (root.y || 0),
      (scalePoint.z || 0) - (root.z || 0)
    ),
    0.001
  );

  return {
    root,
    scale,
    points: modelPoints.map((point) => ({
      x: ((point.x || 0) - root.x) / scale,
      y: ((point.y || 0) - root.y) / scale,
      z: ((point.z || 0) - (root.z || 0)) / scale,
      visibility: point.visibility
    }))
  };
}

function buildSequenceFrames(frames, sequenceLength) {
  const sourceFrames = frames.slice(-sequenceLength);
  const paddingCount = Math.max(0, sequenceLength - sourceFrames.length);
  const firstFrame = sourceFrames[0] || null;

  return [
    ...Array.from({ length: paddingCount }, () => firstFrame),
    ...sourceFrames
  ];
}

function buildInputTensor(session, frames) {
  const shape = getInputShape(session);
  const [, sequenceLength, jointOrFeature, channelCount] = shape.dimensions;
  const sequenceFrames = buildSequenceFrames(frames, sequenceLength);
  const modelFrames = sequenceFrames.map((frame) => toModelFrame(frame, jointOrFeature));
  const data = new Float32Array(shape.dimensions.reduce((total, value) => total * value, 1));

  if (shape.layout === "btvc") {
    modelFrames.forEach((frame, timeIndex) => {
      for (let jointIndex = 0; jointIndex < jointOrFeature; jointIndex += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const dataIndex =
            timeIndex * jointOrFeature * channelCount +
            jointIndex * channelCount +
            channel;
          data[dataIndex] = getPointChannel(frame.points[jointIndex], channel);
        }
      }
    });
  } else if (shape.layout === "btf") {
    modelFrames.forEach((frame, timeIndex) => {
      for (let featureIndex = 0; featureIndex < jointOrFeature; featureIndex += 1) {
        const jointIndex = Math.floor(featureIndex / DEFAULT_CHANNEL_COUNT);
        const channel = featureIndex % DEFAULT_CHANNEL_COUNT;
        data[timeIndex * jointOrFeature + featureIndex] = getPointChannel(
          frame.points[jointIndex],
          channel
        );
      }
    });
  } else {
    for (let featureIndex = 0; featureIndex < shape.dimensions[1]; featureIndex += 1) {
      const frameFeatureCount = DEFAULT_JOINT_COUNT * DEFAULT_CHANNEL_COUNT;
      const frameIndex = Math.floor(featureIndex / frameFeatureCount);
      const localFeatureIndex = featureIndex % frameFeatureCount;
      const jointIndex = Math.floor(localFeatureIndex / DEFAULT_CHANNEL_COUNT);
      const channel = localFeatureIndex % DEFAULT_CHANNEL_COUNT;
      data[featureIndex] = getPointChannel(
        modelFrames[frameIndex]?.points[jointIndex],
        channel
      );
    }
  }

  return {
    inputName: shape.inputName,
    tensor: new ort.Tensor("float32", data, shape.dimensions),
    denormalize:
      modelFrames[modelFrames.length - 1] ||
      toModelFrame(frames[frames.length - 1] || { landmarks: [] }, jointOrFeature)
  };
}

function parseLandmarks(outputTensor, currentLandmarks = [], denormalize) {
  const output = outputTensor?.data;
  const dimensions = outputTensor?.dims || [];

  if (!output?.length || !currentLandmarks.length) return null;

  const frameCount = dimensions.length === 4
    ? resolveDim(dimensions[1], DEFAULT_FUTURE_LENGTH)
    : dimensions.length === 3 && dimensions[1] !== 33
      ? resolveDim(dimensions[1], DEFAULT_FUTURE_LENGTH)
      : 1;
  const availablePerFrame = Math.floor(output.length / Math.max(frameCount, 1));
  const jointCount = availablePerFrame >= 33 * DEFAULT_CHANNEL_COUNT
    ? 33
    : availablePerFrame >= DEFAULT_JOINT_COUNT * DEFAULT_CHANNEL_COUNT
      ? DEFAULT_JOINT_COUNT
      : 0;
  const channelCount = jointCount ? Math.floor(availablePerFrame / jointCount) : 0;

  if (!jointCount || channelCount < 2) return null;

  const landmarks = currentLandmarks.map((point) => ({ ...point }));
  const root = denormalize?.root || { x: 0, y: 0, z: 0 };
  const scale = denormalize?.scale || 1;
  const frameOffset = Math.max(0, frameCount - 1) * jointCount * channelCount;
  const outputMap = jointCount === 33
    ? Array.from({ length: 33 }, (_, index) => index)
    : MODEL_TO_MEDIAPIPE;

  outputMap.forEach((targetIndex, jointIndex) => {
    if (!Number.isInteger(targetIndex)) return;

    const baseIndex = frameOffset + jointIndex * channelCount;
    const x = root.x + output[baseIndex] * scale;
    const y = root.y + output[baseIndex + 1] * scale;
    const z = (root.z || 0) + (output[baseIndex + 2] || 0) * scale;

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    landmarks[targetIndex] = {
      ...landmarks[targetIndex],
      x,
      y,
      z,
      visibility: landmarks[targetIndex]?.visibility
    };
  });

  return landmarks;
}

function averageLandmark(landmarks, indexes) {
  const points = indexes.map((index) => landmarks[index]).filter(Boolean);

  if (!points.length) return null;

  return {
    x: points.reduce((total, point) => total + (point.x || 0), 0) / points.length,
    y: points.reduce((total, point) => total + (point.y || 0), 0) / points.length,
    z: points.reduce((total, point) => total + (point.z || 0), 0) / points.length
  };
}

function bodyScale(landmarks) {
  const lengths = BODY_SCALE_EDGES
    .map(([from, to]) => distance2d(landmarks?.[from], landmarks?.[to]))
    .filter((value) => Number.isFinite(value) && value > 0.001)
    .sort((first, second) => first - second);

  if (!lengths.length) return 0.001;

  return lengths[Math.floor(lengths.length / 2)];
}

function distance2d(first, second) {
  return Math.hypot(
    (first?.x || 0) - (second?.x || 0),
    (first?.y || 0) - (second?.y || 0)
  );
}

function alignPredictionToCurrent(predictedLandmarks, currentLandmarks = []) {
  if (!predictedLandmarks?.length || !currentLandmarks.length) return null;

  const predictedAnchor = averageLandmark(predictedLandmarks, BODY_ANCHOR_JOINTS);
  const currentAnchor = averageLandmark(currentLandmarks, BODY_ANCHOR_JOINTS);

  if (!predictedAnchor || !currentAnchor) return predictedLandmarks;

  const scale = bodyScale(currentLandmarks) / bodyScale(predictedLandmarks);
  const safeScale = Number.isFinite(scale) ? Math.max(0.35, Math.min(4, scale)) : 1;

  return predictedLandmarks.map((point, index) => {
    const current = currentLandmarks[index];

    if (!point) return point;
    if (BODY_ANCHOR_JOINTS.includes(index) && current) return { ...current };

    return {
      ...point,
      x: currentAnchor.x + (point.x - predictedAnchor.x) * safeScale,
      y: currentAnchor.y + (point.y - predictedAnchor.y) * safeScale,
      z: currentAnchor.z + ((point.z || 0) - (predictedAnchor.z || 0)) * safeScale,
      visibility: current?.visibility ?? point.visibility
    };
  });
}

function stabilizePrediction(predictedLandmarks, currentLandmarks = []) {
  if (!predictedLandmarks?.length || !currentLandmarks.length) return null;

  return predictedLandmarks.map((point, index) => {
    const current = currentLandmarks[index];

    if (!point || !current) return point;

    const dx = point.x - current.x;
    const dy = point.y - current.y;
    const dz = (point.z || 0) - (current.z || 0);
    const distance = Math.hypot(dx, dy, dz);
    const scale = distance > MAX_VISUAL_JOINT_DELTA
      ? MAX_VISUAL_JOINT_DELTA / distance
      : 1;

    return {
      ...point,
      x: current.x + dx * scale,
      y: current.y + dy * scale,
      z: (current.z || 0) + dz * scale,
      visibility: current.visibility
    };
  });
}

export class StgatOnnxPredictor {
  constructor({ modelPath = MODEL_PATH } = {}) {
    this.modelPath = modelPath;
    this.sessionPromise = null;
    this.session = null;
    this.latestPrediction = null;
    this.isRunning = false;
    this.status = "not_loaded";
  }

  load() {
    if (this.session) return Promise.resolve(this.session);

    if (!this.sessionPromise) {
      this.status = "loading";
      this.sessionPromise = ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["wasm"]
      })
        .then((session) => {
          this.session = session;
          this.status = "ready";
          return session;
        })
        .catch((error) => {
          const message = error?.message || `${error}` || "ONNX model failed to load";

          this.status = "load_failed";
          this.latestPrediction = {
            source: "onnx",
            status: "load_failed",
            error: message,
            model_path: this.modelPath,
            wasm_paths: ort.env.wasm.wasmPaths
          };
          return null;
        });
    }

    return this.sessionPromise;
  }

  update({ frames, currentLandmarks, actionContext }) {
    this.load().then((session) => {
      if (!session || this.isRunning || !frames.length) return;

      this.isRunning = true;
      const { inputName, tensor, denormalize } = buildInputTensor(session, frames);

      session
        .run({ [inputName]: tensor })
        .then((outputs) => {
          const outputName = session.outputNames[0];
          const outputTensor = outputs[outputName];
          const rawLandmarks = parseLandmarks(outputTensor, currentLandmarks, denormalize);
          const alignedLandmarks = alignPredictionToCurrent(rawLandmarks, currentLandmarks);
          const landmarks = stabilizePrediction(alignedLandmarks, currentLandmarks);

          this.latestPrediction = {
            source: "onnx",
            status: landmarks ? "ready_stabilized" : "output_shape_unsupported",
            model_name: "Spatio-Temporal Graph Attention Transformer",
            prediction_horizon_ms: actionContext?.attention_prediction_horizon_ms || null,
            landmarks,
            input_names: session.inputNames,
            output_names: session.outputNames,
            output_dims: outputTensor?.dims || []
          };
        })
        .catch((error) => {
          this.latestPrediction = {
            source: "onnx",
            status: "run_failed",
            error: error?.message || "ONNX inference failed",
            model_name: "Spatio-Temporal Graph Attention Transformer"
          };
        })
        .finally(() => {
          this.isRunning = false;
        });
    });

    return this.latestPrediction;
  }
}
