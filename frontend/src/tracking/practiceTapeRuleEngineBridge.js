import { TrackingSessionEngine } from "./trackingSessionEngine.js";

function closestFrame(frames, timestampMs, toleranceMs) {
  if (!frames.length || !Number.isFinite(timestampMs)) return null;
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = frames[middle].timestamp_ms;
    if (value < timestampMs) low = middle + 1;
    else if (value > timestampMs) high = middle - 1;
    else return frames[middle];
  }

  const candidates = [frames[low], frames[high]].filter(Boolean);
  const closest = candidates.sort(
    (first, second) =>
      Math.abs(first.timestamp_ms - timestampMs) -
      Math.abs(second.timestamp_ms - timestampMs)
  )[0];
  return closest && Math.abs(closest.timestamp_ms - timestampMs) <= toleranceMs
    ? closest
    : null;
}

function indexedLandmarks(landmarks = []) {
  return landmarks.map((point, index) => ({
    ...point,
    index: Number.isFinite(point?.index) ? point.index : index
  }));
}

function landmarkVelocities(current, previous, deltaSeconds) {
  if (!previous || deltaSeconds <= 0) return {};
  return Object.fromEntries(current.map((point, index) => {
    const prior = previous[index];
    return [index, {
      x: ((point?.x || 0) - (prior?.x || 0)) / deltaSeconds,
      y: ((point?.y || 0) - (prior?.y || 0)) / deltaSeconds,
      z: ((point?.z || 0) - (prior?.z || 0)) / deltaSeconds
    }];
  }));
}

function tapeLandmarks(frame) {
  if (frame?.measurementLandmarks?.length) return frame.measurementLandmarks;
  if (frame?.observedLandmarks?.length) return frame.observedLandmarks;
  return frame?.landmarks || [];
}

function compactSummary(summary) {
  const result = { ...summary };
  delete result.raw_timeline;
  delete result.corrected_timeline;
  return result;
}

function compactFrame(frame) {
  if (!frame) return null;
  return {
    timestamp_ms: frame.timestamp_ms,
    session_state: frame.session_state,
    rep_id: frame.rep_id,
    rep_state: frame.rep_state,
    step: frame.step,
    phase: frame.phase,
    confidence: frame.confidence,
    tracking_lost: frame.tracking_lost,
    unknown_movement: frame.unknown_movement,
    form_errors: frame.form_errors || [],
    post_session_corrected: Boolean(frame.post_session_corrected),
    tracking_repaired: Boolean(frame.tracking_repaired),
    rejected_transition: Boolean(frame.rejected_transition)
  };
}

export function attachRuleEngineAnalysisToTape(
  tapeFrames,
  {
    rawFrames = [],
    correctedFrames = [],
    toleranceMs = 80
  } = {}
) {
  return (tapeFrames || []).map((tapeFrame) => {
    const timestampMs = Number(tapeFrame.sourceTimestampMs);
    const raw = closestFrame(rawFrames, timestampMs, toleranceMs);
    const corrected = closestFrame(correctedFrames, timestampMs, toleranceMs);
    const changed = Boolean(
      raw &&
      corrected &&
      (
        raw.step !== corrected.step ||
        raw.phase !== corrected.phase ||
        raw.rep_id !== corrected.rep_id ||
        raw.rep_state !== corrected.rep_state ||
        Boolean(raw.tracking_lost) !== Boolean(corrected.tracking_lost)
      )
    );

    return {
      ...tapeFrame,
      ruleEngineAnalysis: {
        raw: compactFrame(raw),
        corrected: compactFrame(corrected),
        changed
      }
    };
  });
}

export function reanalyzePracticeTapeWithRuleEngine(
  tapeFrames,
  techniquePackage,
  { mode = "practice" } = {}
) {
  if (!techniquePackage || !(tapeFrames || []).length) return null;

  const engine = new TrackingSessionEngine(techniquePackage, { mode });
  let previousLandmarks = null;
  let previousTimestampMs = null;

  for (const tapeFrame of tapeFrames) {
    const timestampMs = Number(
      tapeFrame.sourceTimestampMs ?? tapeFrame.elapsedMs
    );
    if (!Number.isFinite(timestampMs) || timestampMs === previousTimestampMs) {
      continue;
    }

    const landmarks = indexedLandmarks(tapeLandmarks(tapeFrame));
    if (!landmarks.length) continue;
    const deltaSeconds = previousTimestampMs === null
      ? 0
      : Math.max((timestampMs - previousTimestampMs) / 1000, 0.001);
    engine.update(
      {
        timestamp: timestampMs / 1000,
        tracking: {
          confidence: Number.isFinite(tapeFrame.trackingConfidence)
            ? tapeFrame.trackingConfidence
            : tapeFrame.trackingReliable === false ? 0 : 1
        },
        motion_context: {
          normalized_landmarks: landmarks,
          angles_deg: tapeFrame.angles || {},
          velocity: landmarkVelocities(
            landmarks,
            previousLandmarks,
            deltaSeconds
          )
        }
      },
      {
        evaluationContext: {
          practice_step: Number(tapeFrame.step),
          practice_phase: tapeFrame.phase || null,
          scorable: tapeFrame.scorable !== false
        }
      }
    );
    previousLandmarks = landmarks;
    previousTimestampMs = timestampMs;
  }

  if (previousTimestampMs === null) return null;
  const summary = engine.end(previousTimestampMs + 34);
  const rawFrames = summary.raw_timeline?.frames || [];
  const corrected = summary.corrected_timeline;
  const correctedFrames = corrected?.frames || rawFrames;
  const ruleEngineAnalysis = {
    summary: compactSummary(summary),
    corrections: corrected?.corrections || [],
    segments: corrected?.segments || [],
    repetitions: corrected?.repetitions || summary.repetitions || []
  };

  return {
    frames: attachRuleEngineAnalysisToTape(tapeFrames, {
      rawFrames,
      correctedFrames
    }),
    ruleEngineAnalysis,
    rawFrames,
    correctedFrames
  };
}
