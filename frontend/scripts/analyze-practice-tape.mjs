import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BiomechanicalFeatureExtractor } from "../src/tracking/biomechanicalFeatureExtractor.js";
import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import { TrackingSessionEngine } from "../src/tracking/trackingSessionEngine.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const techniqueId = process.argv[2] || "jab";
const techniqueDirectory = path.resolve(
  scriptDirectory,
  "../../backend/data/techniques",
  techniqueId
);
const packageParts = [
  "manifest",
  "states",
  "transitions",
  "errors",
  "modes",
  "cues"
];

const input = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    value += chunk;
  });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});
const document = JSON.parse(input);
const techniquePackage = createTechniquePackage(Object.fromEntries(
  await Promise.all(packageParts.map(async (name) => [
    name,
    JSON.parse(await readFile(path.join(techniqueDirectory, `${name}.json`), "utf8"))
  ]))
));

function decodeLandmarks(encoded = []) {
  return encoded.map(([x, y, z, visibility], index) => ({
    index,
    x: Number.isFinite(x) ? x / 10000 : null,
    y: Number.isFinite(y) ? y / 10000 : null,
    z: Number.isFinite(z) ? z / 10000 : null,
    visibility: Number.isFinite(visibility) ? visibility / 10000 : 1
  }));
}

function calculateVelocities(current, previous, deltaSeconds) {
  if (!previous || deltaSeconds <= 0) return {};
  return Object.fromEntries(current.map((point, index) => {
    const prior = previous[index];
    return [index, {
      x: ((point.x || 0) - (prior?.x || 0)) / deltaSeconds,
      y: ((point.y || 0) - (prior?.y || 0)) / deltaSeconds,
      z: ((point.z || 0) - (prior?.z || 0)) / deltaSeconds
    }];
  }));
}

function stateRuns(frames) {
  return frames.reduce((runs, frame, index) => {
    const signature = [
      frame.session_state,
      frame.rep_id ?? "-",
      frame.rep_state,
      frame.step,
      frame.phase
    ].join("|");
    const last = runs[runs.length - 1];
    if (last?.signature === signature) {
      last.end_index = index;
      last.end_ms = frame.timestamp_ms;
      last.frames += 1;
      return runs;
    }
    runs.push({
      signature,
      start_index: index,
      end_index: index,
      start_ms: frame.timestamp_ms,
      end_ms: frame.timestamp_ms,
      frames: 1
    });
    return runs;
  }, []).map(({ signature, ...run }) => ({
    ...run,
    state: signature.split("|")
  }));
}

function range(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return {
    min: Number(Math.min(...finite).toFixed(3)),
    max: Number(Math.max(...finite).toFixed(3))
  };
}

const engine = new TrackingSessionEngine(techniquePackage, { mode: "practice" });
const extractor = new BiomechanicalFeatureExtractor();
const featureHistory = [];
let previousLandmarks = null;
let previousTimestampMs = null;
let recordingStartMs = null;

for (const frame of document.frames || []) {
  const timestampMs = Number(frame.st ?? frame.t);
  if (timestampMs === previousTimestampMs) continue;
  recordingStartMs ??= timestampMs;
  const landmarks = decodeLandmarks(
    frame.wp?.length ? frame.wp : frame.op?.length ? frame.op : frame.p
  );
  const deltaSeconds = previousTimestampMs === null
    ? 0
    : Math.max((timestampMs - previousTimestampMs) / 1000, 0.001);
  const level1State = {
    timestamp: timestampMs / 1000,
    tracking: {
      confidence: Number.isFinite(frame.tc) ? frame.tc / 1000 : 0
    },
    motion_context: {
      normalized_landmarks: landmarks,
      angles_deg: Object.fromEntries(
        Object.entries(frame.av || {}).map(([name, value]) => [name, value / 100])
      ),
      velocity: calculateVelocities(landmarks, previousLandmarks, deltaSeconds)
    }
  };
  const extracted = extractor.update(level1State, {
    leadSide: techniquePackage.manifest.default_side,
    kickSide: techniquePackage.manifest.default_side
  });
  if (extracted) {
    featureHistory.push({
      elapsed_ms: timestampMs - recordingStartMs,
      ...extracted.features
    });
    engine.updateFeatures(extracted);
  }
  previousLandmarks = landmarks;
  previousTimestampMs = timestampMs;
}

const summary = engine.end((previousTimestampMs || 0) + 34);
const featureNames = techniquePackage.manifest.required_features;
console.log(JSON.stringify({
  source: {
    frames: document.frames?.length || 0,
    duration_ms: document.duration_ms,
    technique: document.metadata?.techniqueName,
    target_repetitions: document.metadata?.targetReps,
    has_saved_rule_engine_analysis: Boolean(document.metadata?.ruleEngineAnalysis)
  },
  feature_ranges: Object.fromEntries(featureNames.map((name) => [
    name,
    range(featureHistory.map((features) => features[name]))
  ])),
  initial_feature_samples: featureHistory.slice(0, 15),
  extension_feature_samples: featureHistory.filter(
    (features) => features.lead_elbow_angle >= 100
  ),
  summary: {
    total_repetitions: summary.total_repetitions,
    completed_repetitions: summary.completed_repetitions,
    aborted_repetitions: summary.aborted_repetitions,
    tracking_quality_percentage: summary.tracking_quality_percentage,
    corrections_applied: summary.corrections_applied,
    common_form_errors: summary.common_form_errors
  },
  repetitions: summary.repetitions,
  final_repetition_frames: (summary.raw_timeline?.frames || [])
    .filter((frame) => frame.timestamp_ms - recordingStartMs >= 5250)
    .map((frame) => ({
      elapsed_ms: frame.timestamp_ms - recordingStartMs,
      step: frame.step,
      phase: frame.phase,
      rep_id: frame.rep_id,
      rep_state: frame.rep_state,
      unknown_movement: frame.unknown_movement,
      event: frame.temporal_event?.type || null,
      event_to: frame.temporal_event?.to_state || null
    })),
  corrected_state_runs: stateRuns(summary.corrected_timeline?.frames || []),
  corrections: summary.corrected_timeline?.corrections || []
}, null, 2));
