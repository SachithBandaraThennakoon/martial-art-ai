import * as ort from "onnxruntime-web/wasm";
import { configureWasmRuntime } from "./onnxRuntimeAssets.js";
import {
  logitsToStateProbabilities,
  validateTemporalModelMetadata
} from "./temporalModelContract.js";

const MODEL_PATH = "/models/jab/temporal_phase_classifier.onnx?v=jab-temporal-v1";
const METADATA_PATH = "/models/jab/temporal_phase_classifier.metadata.json?v=jab-temporal-v1";
const MINIMUM_FRAMES = 12;
const INFERENCE_INTERVAL_MS = 100;

configureWasmRuntime(ort);

function distance(first, second) {
  return Math.hypot(
    (first?.x || 0) - (second?.x || 0),
    (first?.y || 0) - (second?.y || 0),
    (first?.z || 0) - (second?.z || 0)
  );
}

function center(first, second) {
  return {
    x: ((first?.x || 0) + (second?.x || 0)) / 2,
    y: ((first?.y || 0) + (second?.y || 0)) / 2,
    z: ((first?.z || 0) + (second?.z || 0)) / 2
  };
}

function normalizePose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return null;
  const root = center(landmarks[23], landmarks[24]);
  const shoulders = distance(landmarks[11], landmarks[12]);
  const torso = distance(center(landmarks[11], landmarks[12]), root);
  const scale = Math.max(shoulders, torso, 0.0001);
  return landmarks.slice(0, 33).flatMap((point) => [
    ((point?.x || 0) - root.x) / scale,
    ((point?.y || 0) - root.y) / scale,
    ((point?.z || 0) - root.z) / scale,
    Math.max(0, Math.min(1, Number(point?.visibility) || 0))
  ]);
}

export class TemporalPhaseOnnxPredictor {
  constructor(techniquePackage) {
    this.techniquePackage = techniquePackage;
    this.session = null;
    this.metadata = null;
    this.frames = [];
    this.pending = false;
    this.lastInferenceAt = 0;
    this.status = "idle";
    this.error = null;
    this.latestPrediction = null;
  }

  async load() {
    if (this.session || this.status === "loading") return;
    this.status = "loading";
    try {
      const response = await fetch(METADATA_PATH);
      if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
      const metadata = await response.json();
      const validation = validateTemporalModelMetadata(
        metadata,
        this.techniquePackage
      );
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      this.metadata = metadata;
      this.session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      this.status = "ready";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = "error";
    }
  }

  reset() {
    this.frames = [];
    this.latestPrediction = null;
    this.lastInferenceAt = 0;
  }

  update({ landmarks, timestampMs }) {
    const normalized = normalizePose(landmarks);
    if (!normalized) return this.latestPrediction;
    const sequenceLength = Number(this.metadata?.input?.sequence_length) || 90;
    this.frames.push(normalized);
    if (this.frames.length > sequenceLength) this.frames.shift();
    if (
      !this.session ||
      this.pending ||
      this.frames.length < MINIMUM_FRAMES ||
      timestampMs - this.lastInferenceAt < INFERENCE_INTERVAL_MS
    ) {
      return this.latestPrediction;
    }
    this.lastInferenceAt = timestampMs;
    this.pending = true;
    const values = new Float32Array(sequenceLength * 33 * 4);
    const offsetFrames = sequenceLength - this.frames.length;
    this.frames.forEach((frame, frameIndex) => {
      values.set(frame, (offsetFrames + frameIndex) * 33 * 4);
    });
    const tensor = new ort.Tensor(
      "float32",
      values,
      [1, sequenceLength, 33, 4]
    );
    this.session.run({ [this.metadata.input.name]: tensor })
      .then((outputs) => {
        const output = outputs[this.metadata.output.name];
        if (!output?.data) throw new Error("state_logits output is missing");
        const labels = this.metadata.output.labels;
        const finalOffset = (sequenceLength - 1) * labels.length;
        const logits = Array.from(
          output.data.slice(finalOffset, finalOffset + labels.length)
        );
        const probabilities = logitsToStateProbabilities(logits, labels);
        const [state, confidence] = Object.entries(probabilities)
          .sort((left, right) => right[1] - left[1])[0] || [null, 0];
        this.latestPrediction = {
          timestamp_ms: timestampMs,
          state,
          confidence,
          probabilities,
          status: "primary",
          evaluation_origin: this.metadata.evaluation_origin
        };
      })
      .catch((error) => {
        this.error = error instanceof Error ? error.message : String(error);
        this.status = "error";
      })
      .finally(() => {
        this.pending = false;
      });
    return this.latestPrediction;
  }
}
