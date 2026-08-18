import * as ort from "onnxruntime-web/wasm";
import { configureWasmRuntime } from "./onnxRuntimeAssets.js";
import {
  logitsToStateProbabilities,
  validateUniversalTemporalMetadata
} from "./temporalModelContract.js";

const MODEL_PATH = "/models/universal-temporal/martial_arts_temporal.onnx";
const METADATA_PATH =
  "/models/universal-temporal/martial_arts_temporal.metadata.json";
const MINIMUM_FRAMES = 12;
const INFERENCE_INTERVAL_MS = 70;

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

function phasesToNative(probabilities, phaseMap) {
  const native = {
    __UNKNOWN__: probabilities.__UNKNOWN__ || 0,
    __TRACKING_LOST__: probabilities.__TRACKING_LOST__ || 0
  };
  Object.entries(phaseMap).forEach(([phase, state]) => {
    native[state] = (native[state] || 0) + (probabilities[phase] || 0);
  });
  return native;
}

export class UniversalTemporalOnnxPredictor {
  constructor(techniquePackage) {
    this.techniquePackage = techniquePackage;
    this.session = null;
    this.metadata = null;
    this.techniqueIndex = -1;
    this.frames = [];
    this.pending = false;
    this.lastInferenceAt = 0;
    this.latestPrediction = null;
    this.status = "idle";
    this.error = null;
  }

  async load() {
    if (this.session || this.status === "loading") return;
    this.status = "loading";
    try {
      const response = await fetch(METADATA_PATH);
      if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
      const metadata = await response.json();
      const validation = validateUniversalTemporalMetadata(
        metadata,
        this.techniquePackage
      );
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      this.metadata = metadata;
      this.techniqueIndex = validation.techniqueIndex;
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
    const sequenceLength =
      Number(this.metadata?.inputs?.landmarks?.sequence_length) || 90;
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
    const offset = sequenceLength - this.frames.length;
    this.frames.forEach((frame, index) => {
      values.set(frame, (offset + index) * 33 * 4);
    });
    const feeds = {
      [this.metadata.inputs.landmarks.name]: new ort.Tensor(
        "float32",
        values,
        [1, sequenceLength, 33, 4]
      ),
      [this.metadata.inputs.technique.name]: new ort.Tensor(
        "int64",
        BigInt64Array.from([BigInt(this.techniqueIndex)]),
        [1]
      )
    };
    this.session.run(feeds)
      .then((outputs) => {
        const output = outputs[this.metadata.output.name];
        if (!output?.data) throw new Error("phase logits output is missing");
        const labels = this.metadata.output.labels;
        const start = (sequenceLength - 1) * labels.length;
        const phaseProbabilities = logitsToStateProbabilities(
          Array.from(output.data.slice(start, start + labels.length)),
          labels
        );
        const probabilities = phasesToNative(
          phaseProbabilities,
          this.metadata.techniques[this.techniquePackage.id].phase_to_native
        );
        const [state, confidence] = Object.entries(probabilities)
          .sort((left, right) => right[1] - left[1])[0] || [null, 0];
        this.latestPrediction = {
          timestamp_ms: timestampMs,
          state,
          confidence,
          probabilities,
          phase_probabilities: phaseProbabilities,
          status: "primary",
          model_type: "universal-temporal-phase"
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
