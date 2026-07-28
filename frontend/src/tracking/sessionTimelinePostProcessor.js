import { decodeDurationAwareSequence } from "./durationAwareSequenceDecoder.js";

function clone(value) {
  return structuredClone(value);
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function estimateFrameInterval(frames) {
  const intervals = frames
    .slice(1)
    .map((frame, index) => frame.timestamp_ms - frames[index].timestamp_ms)
    .filter((interval) => Number.isFinite(interval) && interval > 0)
    .sort((first, second) => first - second);
  if (!intervals.length) return 33;
  return intervals[Math.floor(intervals.length / 2)];
}

function buildSegments(frames, frameIntervalMs) {
  const segments = [];
  frames.forEach((frame, index) => {
    const key = `${frame.step ?? "null"}:${Boolean(frame.tracking_lost)}:${Boolean(
      frame.rejected_transition
    )}`;
    const current = segments[segments.length - 1];
    if (current?.key === key) {
      current.end_index = index;
      current.end_ms = frame.timestamp_ms;
      current.frame_count += 1;
      return;
    }
    segments.push({
      key,
      step: frame.step ?? null,
      tracking_lost: Boolean(frame.tracking_lost),
      rejected_transition: Boolean(frame.rejected_transition),
      start_index: index,
      end_index: index,
      start_ms: frame.timestamp_ms,
      end_ms: frame.timestamp_ms,
      frame_count: 1
    });
  });

  return segments.map((segment, index) => {
    const nextStart = segments[index + 1]?.start_ms;
    return {
      ...segment,
      duration_ms: Math.max(
        frameIntervalMs,
        (Number.isFinite(nextStart) ? nextStart : segment.end_ms + frameIntervalMs) -
          segment.start_ms
      )
    };
  });
}

function relabelRange(frames, startIndex, endIndex, patch) {
  for (let index = startIndex; index <= endIndex; index += 1) {
    Object.assign(frames[index], patch, {
      post_session_corrected: true
    });
  }
}

function repairTrackingGaps({
  frames,
  frameIntervalMs,
  maximumGapMs,
  corrections
}) {
  let index = 0;
  while (index < frames.length) {
    if (!frames[index].tracking_lost) {
      index += 1;
      continue;
    }

    const startIndex = index;
    while (index + 1 < frames.length && frames[index + 1].tracking_lost) {
      index += 1;
    }
    const endIndex = index;
    const previous = frames[startIndex - 1];
    const next = frames[endIndex + 1];
    const durationMs =
      (next?.timestamp_ms ?? frames[endIndex].timestamp_ms + frameIntervalMs) -
      frames[startIndex].timestamp_ms;
    const repairable =
      durationMs <= maximumGapMs &&
      previous?.step &&
      previous.step === next?.step;

    if (repairable) {
      relabelRange(frames, startIndex, endIndex, {
        step: previous.step,
        phase: "HOLD",
        tracking_lost: false,
        tracking_repaired: true,
        confidence: round(
          Math.min(previous.confidence || 0, next.confidence || 0) * 0.8
        )
      });
      corrections.push({
        type: "BRIEF_TRACKING_GAP_REPAIRED",
        start_ms: frames[startIndex].timestamp_ms,
        end_ms: frames[endIndex].timestamp_ms,
        duration_ms: durationMs,
        repaired_step: previous.step
      });
    }
    index += 1;
  }
}

function removeFalseMicrostates({
  frames,
  frameIntervalMs,
  minimumStateDurationMs,
  corrections
}) {
  for (let pass = 0; pass < 4; pass += 1) {
    const segments = buildSegments(frames, frameIntervalMs);
    let changed = false;

    for (let index = 1; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const previous = segments[index - 1];
      const next = segments[index + 1];
      if (
        segment.duration_ms >= minimumStateDurationMs ||
        segment.tracking_lost ||
        !previous.step ||
        previous.step !== next.step ||
        segment.step === previous.step
      ) {
        continue;
      }

      relabelRange(frames, segment.start_index, segment.end_index, {
        step: previous.step,
        phase: "HOLD",
        false_microstate_removed: true
      });
      corrections.push({
        type: "FALSE_MICROSTATE_REMOVED",
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        duration_ms: segment.duration_ms,
        removed_step: segment.step,
        replacement_step: previous.step
      });
      changed = true;
    }
    if (!changed) break;
  }
}

function rejectImpossibleTransitions({
  frames,
  frameIntervalMs,
  techniquePackage,
  corrections
}) {
  const segments = buildSegments(frames, frameIntervalMs);
  let previousKnown = null;

  segments.forEach((segment) => {
    if (!segment.step || segment.tracking_lost) return;
    if (!previousKnown) {
      previousKnown = segment;
      return;
    }
    if (
      segment.step === previousKnown.step ||
      techniquePackage.canTransition(previousKnown.step, segment.step)
    ) {
      previousKnown = segment;
      return;
    }

    relabelRange(frames, segment.start_index, segment.end_index, {
      step: null,
      phase: null,
      unknown_movement: true,
      rejected_transition: true
    });
    corrections.push({
      type: "IMPOSSIBLE_TRANSITION_REJECTED",
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      duration_ms: segment.duration_ms,
      from_step: previousKnown.step,
      rejected_step: segment.step
    });
  });
}

function rebuildPhases(frames, frameIntervalMs) {
  const segments = buildSegments(frames, frameIntervalMs);
  segments.forEach((segment) => {
    if (!segment.step) return;
    for (let index = segment.start_index; index <= segment.end_index; index += 1) {
      frames[index].phase =
        index === segment.start_index
          ? "ENTRY"
          : index === segment.end_index && segment.frame_count > 1
            ? "EXIT"
            : "HOLD";
    }
  });
  return buildSegments(frames, frameIntervalMs);
}

function repetitionFromActive(active, status, endSegment, frames) {
  const endIndex = endSegment?.start_index ?? active.last_index;
  const endMs = endSegment?.start_ms ?? frames[endIndex].timestamp_ms;
  const repetitionFrames = frames.slice(active.start_index, endIndex + 1);
  const formErrors = new Set(
    repetitionFrames.flatMap((frame) => frame.form_errors || [])
  );
  return {
    rep_id: active.rep_id,
    status,
    start_ms: active.start_ms,
    end_ms: endMs,
    duration_ms: Math.max(0, endMs - active.start_ms),
    start_index: active.start_index,
    end_index: endIndex,
    confidence: round(average(
      repetitionFrames.map((frame) => frame.confidence)
    )),
    response_time_ms: repetitionFrames
      .map((frame) => frame.cue_timing_ms)
      .find(Number.isFinite) ?? null,
    form_errors: [...formErrors],
    state_sequence: [...active.state_sequence],
    incomplete: status !== "completed"
  };
}

function rebuildRepetitions({
  frames,
  segments,
  techniquePackage,
  maximumUnknownMovementMs
}) {
  const initialState = techniquePackage.manifest.initial_state;
  const repetitions = [];
  let active = null;
  let previousStep = null;

  segments.forEach((segment) => {
    if (!segment.step) {
      if (
        active &&
        segment.duration_ms > maximumUnknownMovementMs
      ) {
        repetitions.push(
          repetitionFromActive(active, "aborted_unknown_movement", segment, frames)
        );
        active = null;
      }
      return;
    }

    if (
      !active &&
      previousStep === initialState &&
      segment.step !== initialState &&
      techniquePackage.canTransition(previousStep, segment.step)
    ) {
      active = {
        rep_id: repetitions.length + 1,
        start_ms: segment.start_ms,
        start_index: segment.start_index,
        last_index: segment.end_index,
        state_sequence: [initialState, segment.step]
      };
    } else if (active && segment.step !== previousStep) {
      active.state_sequence.push(segment.step);
      active.last_index = segment.end_index;
    } else if (active) {
      active.last_index = segment.end_index;
    }

    const transition = previousStep
      ? techniquePackage.transitions.transitions[previousStep]
      : null;
    if (
      active &&
      previousStep &&
      techniquePackage.canTransition(previousStep, segment.step) &&
      transition?.completes_repetition
    ) {
      repetitions.push(
        repetitionFromActive(active, "completed", segment, frames)
      );
      active = null;
    } else if (
      active &&
      segment.step === initialState &&
      previousStep !== initialState
    ) {
      repetitions.push(
        repetitionFromActive(active, "aborted_incomplete", segment, frames)
      );
      active = null;
    }
    previousStep = segment.step;
  });

  if (active) {
    repetitions.push(
      repetitionFromActive(active, "aborted_session_end", null, frames)
    );
  }

  frames.forEach((frame) => {
    frame.rep_id = null;
    frame.rep_state = "WAITING";
  });
  repetitions.forEach((repetition) => {
    for (
      let index = repetition.start_index;
      index <= repetition.end_index;
      index += 1
    ) {
      frames[index].rep_id = repetition.rep_id;
      frames[index].rep_state =
        index === repetition.start_index
          ? "REP_STARTED"
          : index === repetition.end_index
            ? repetition.status === "completed"
              ? "REP_COMPLETED"
              : "REP_ABORTED"
            : "REP_ACTIVE";
    }
  });

  return repetitions.map((repetition) => {
    const publicRepetition = { ...repetition };
    delete publicRepetition.start_index;
    delete publicRepetition.end_index;
    return publicRepetition;
  });
}

function summarize({
  frames,
  segments,
  repetitions,
  corrections
}) {
  const completed = repetitions.filter(
    (repetition) => repetition.status === "completed"
  );
  const errors = repetitions.flatMap((repetition) => repetition.form_errors);
  const errorCounts = errors.reduce((counts, errorId) => ({
    ...counts,
    [errorId]: (counts[errorId] || 0) + 1
  }), {});
  const stepDurations = segments.reduce((durations, segment) => {
    if (!segment.step) return durations;
    const values = durations.get(segment.step) || [];
    values.push(segment.duration_ms);
    durations.set(segment.step, values);
    return durations;
  }, new Map());
  const responseTimes = completed
    .map((repetition) => repetition.response_time_ms)
    .filter(Number.isFinite);

  return {
    total_repetitions: repetitions.length,
    completed_repetitions: completed.length,
    aborted_repetitions: repetitions.length - completed.length,
    average_accuracy: round(average(
      completed.map((repetition) => repetition.confidence)
    )),
    average_response_time_ms: responseTimes.length
      ? Math.round(average(responseTimes))
      : null,
    per_step_duration_ms: Object.fromEntries(
      [...stepDurations.entries()].map(([step, durations]) => [
        step,
        Math.round(average(durations))
      ])
    ),
    common_form_errors: Object.entries(errorCounts)
      .map(([error_id, count]) => ({ error_id, count }))
      .sort((first, second) => second.count - first.count),
    tracking_quality_percentage: round(
      average(frames.map((frame) => frame.tracking_confidence)) * 100
    ),
    corrections_applied: corrections.length
  };
}

export function postProcessSessionTimeline({
  frames: sourceFrames,
  techniquePackage,
  config = {}
}) {
  if (!Array.isArray(sourceFrames) || !sourceFrames.length) {
    return {
      frames: [],
      segments: [],
      repetitions: [],
      corrections: [],
      summary: summarize({
        frames: [],
        segments: [],
        repetitions: [],
        corrections: []
      })
    };
  }

  const corrections = [];
  let frames = sourceFrames.map(clone);
  const offlineDecoderConfig = config.offline_decoder || {};
  if (
    offlineDecoderConfig.enabled !== false &&
    frames.some((frame) => frame.state_scores)
  ) {
    const decodedFrames = decodeDurationAwareSequence(
      frames,
      techniquePackage,
      offlineDecoderConfig
    );
    const changedFrames = decodedFrames.filter(
      (frame, index) =>
        frame.step !== frames[index]?.step ||
        Boolean(frame.unknown_movement) !==
          Boolean(frames[index]?.unknown_movement)
    ).length;
    frames = decodedFrames;
    if (changedFrames) {
      corrections.push({
        type: "DURATION_AWARE_SEQUENCE_DECODED",
        changed_frames: changedFrames,
        decoder: "offline_viterbi_v1"
      });
    }
  }
  const frameIntervalMs = estimateFrameInterval(frames);
  const maximumGapMs = Number(
    config.maximum_repairable_tracking_gap_ms ?? 180
  );
  const minimumStateDurationMs = Number(
    config.minimum_state_duration_ms ?? Math.max(70, frameIntervalMs * 2)
  );
  const maximumUnknownMovementMs = Number(
    config.maximum_unknown_movement_ms ?? 500
  );

  repairTrackingGaps({
    frames,
    frameIntervalMs,
    maximumGapMs,
    corrections
  });
  removeFalseMicrostates({
    frames,
    frameIntervalMs,
    minimumStateDurationMs,
    corrections
  });
  rejectImpossibleTransitions({
    frames,
    frameIntervalMs,
    techniquePackage,
    corrections
  });
  const segments = rebuildPhases(frames, frameIntervalMs);
  const repetitions = rebuildRepetitions({
    frames,
    segments,
    techniquePackage,
    maximumUnknownMovementMs
  });

  return {
    schema_version: "1.0",
    technique_id: techniquePackage.id,
    technique_version: techniquePackage.version,
    frames,
    segments: segments.map((segment) => {
      const publicSegment = { ...segment };
      delete publicSegment.key;
      return publicSegment;
    }),
    repetitions,
    corrections,
    summary: summarize({
      frames,
      segments,
      repetitions,
      corrections
    })
  };
}
