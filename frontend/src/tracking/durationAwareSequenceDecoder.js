const UNKNOWN_STATE = "__UNKNOWN__";

const DEFAULT_CONFIG = Object.freeze({
  emission_floor: 0.02,
  unknown_emission_threshold: 0.38,
  transition_penalty: 0.18,
  unknown_transition_penalty: 0.55,
  unknown_min_duration_ms: 100,
  duration_overflow_penalty: 1.4,
  minimum_duration_ratio: 0.65
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function finiteScore(value) {
  return Number.isFinite(Number(value))
    ? clamp(Number(value))
    : 0;
}

function medianFrameInterval(frames) {
  const intervals = frames
    .slice(1)
    .map((frame, index) =>
      Number(frame.timestamp_ms) - Number(frames[index].timestamp_ms)
    )
    .filter((interval) => Number.isFinite(interval) && interval > 0)
    .sort((first, second) => first - second);
  return intervals.length ? intervals[Math.floor(intervals.length / 2)] : 33;
}

function emissionProbability(frame, state, stateNames, config) {
  const maximumStateScore = Math.max(
    0,
    ...stateNames.map((stateName) =>
      finiteScore(frame.state_scores?.[stateName])
    )
  );
  if (state === UNKNOWN_STATE) {
    const complement = 1 - maximumStateScore;
    return maximumStateScore < config.unknown_emission_threshold
      ? Math.max(complement, 0.72)
      : Math.max(
          config.emission_floor,
          complement * 0.42,
          maximumStateScore * 0.55
        );
  }
  return Math.max(
    config.emission_floor,
    finiteScore(frame.state_scores?.[state])
  );
}

function durationOverflowPenalty(durationMs, definition, config) {
  if (!definition || durationMs <= definition.max_duration_ms) return 0;
  return (
    ((durationMs - definition.max_duration_ms) /
      Math.max(definition.max_duration_ms, 1)) *
    config.duration_overflow_penalty
  );
}

function canEnter({
  fromState,
  toState,
  fromDurationMs,
  frameIntervalMs,
  techniquePackage,
  config
}) {
  if (fromState === toState) return true;
  if (toState === UNKNOWN_STATE) return true;
  if (fromState === UNKNOWN_STATE) {
    return (
      fromDurationMs >= config.unknown_min_duration_ms &&
      toState === techniquePackage.manifest.initial_state
    );
  }
  const fromDefinition = techniquePackage.getState(fromState);
  const confirmation = fromDefinition?.confirmation || {};
  const minimumDuration = Math.max(
    Number(fromDefinition?.min_duration_ms || 0) *
      config.minimum_duration_ratio,
    Number(confirmation.min_ms || 0),
    Number(confirmation.min_frames || 1) * frameIntervalMs
  );
  return (
    fromDurationMs >= minimumDuration &&
    techniquePackage.canTransition(fromState, toState)
  );
}

function transitionCost(fromState, toState, config) {
  if (fromState === toState) return 0;
  if (fromState === UNKNOWN_STATE || toState === UNKNOWN_STATE) {
    return config.unknown_transition_penalty;
  }
  return config.transition_penalty;
}

function decodeTrackedSpan(frames, techniquePackage, config) {
  if (!frames.length) return [];
  const stateNames = [...techniquePackage.stateNames];
  const candidateStates = [...stateNames, UNKNOWN_STATE];
  const initialState = techniquePackage.manifest.initial_state;
  const frameIntervalMs = medianFrameInterval(frames);
  const lattice = [];

  frames.forEach((frame, frameIndex) => {
    const timestampMs = Number(frame.timestamp_ms);
    const previousTimestampMs = Number(frames[frameIndex - 1]?.timestamp_ms);
    const deltaMs = frameIndex
      ? Math.max(1, timestampMs - previousTimestampMs)
      : frameIntervalMs;
    const row = new Map();

    candidateStates.forEach((state) => {
      const emission = Math.log(
        emissionProbability(frame, state, stateNames, config)
      );
      if (frameIndex === 0) {
        if (![initialState, UNKNOWN_STATE].includes(state)) return;
        row.set(state, {
          score: emission - (state === UNKNOWN_STATE ? 0.25 : 0),
          durationMs: deltaMs,
          previousState: null
        });
        return;
      }

      let best = null;
      lattice[frameIndex - 1].forEach((previous, previousState) => {
        if (!canEnter({
          fromState: previousState,
          toState: state,
          fromDurationMs: previous.durationMs,
          frameIntervalMs,
          techniquePackage,
          config
        })) {
          return;
        }
        const durationMs =
          previousState === state ? previous.durationMs + deltaMs : deltaMs;
        const definition =
          state === UNKNOWN_STATE ? null : techniquePackage.getState(state);
        const score =
          previous.score +
          emission -
          transitionCost(previousState, state, config) -
          durationOverflowPenalty(durationMs, definition, config);
        if (!best || score > best.score) {
          best = {
            score,
            durationMs,
            previousState
          };
        }
      });
      if (best) row.set(state, best);
    });
    lattice.push(row);
  });

  const finalRow = lattice[lattice.length - 1];
  let selectedState = [...finalRow.entries()]
    .sort((first, second) => second[1].score - first[1].score)[0]?.[0];
  const path = Array(frames.length).fill(UNKNOWN_STATE);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    path[index] = selectedState || UNKNOWN_STATE;
    selectedState = lattice[index].get(path[index])?.previousState ?? null;
  }

  return frames.map((frame, index) => {
    const state = path[index];
    const previousState = path[index - 1] || null;
    const isUnknown = state === UNKNOWN_STATE;
    return {
      ...frame,
      step: isUnknown ? null : state,
      phase: isUnknown
        ? null
        : previousState === state ? "HOLD" : "ENTRY",
      confidence: Number(
        emissionProbability(frame, state, stateNames, config).toFixed(3)
      ),
      unknown_movement: isUnknown,
      offline_decoded: true
    };
  });
}

export function decodeDurationAwareSequence(
  sourceFrames,
  techniquePackage,
  overrides = {}
) {
  if (!Array.isArray(sourceFrames) || !sourceFrames.length) return [];
  if (!techniquePackage?.stateNames?.length) {
    throw new Error(
      "decodeDurationAwareSequence requires a validated technique package"
    );
  }
  const config = {
    ...DEFAULT_CONFIG,
    ...(overrides || {})
  };
  const result = [];
  let trackedSpan = [];

  const flush = () => {
    if (!trackedSpan.length) return;
    result.push(
      ...decodeTrackedSpan(trackedSpan, techniquePackage, config)
    );
    trackedSpan = [];
  };

  sourceFrames.forEach((frame) => {
    if (frame.tracking_lost) {
      flush();
      result.push({
        ...frame,
        step: null,
        phase: null,
        unknown_movement: false,
        offline_decoded: true
      });
      return;
    }
    trackedSpan.push({ ...frame });
  });
  flush();

  return result;
}

export { UNKNOWN_STATE };
