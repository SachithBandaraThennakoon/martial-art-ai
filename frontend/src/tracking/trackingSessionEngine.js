import { BiomechanicalFeatureExtractor } from "./biomechanicalFeatureExtractor.js";
import { PersistentErrorEvaluator } from "./persistentErrorEvaluator.js";
import { SessionTimelineRecorder } from "./sessionTimelineRecorder.js";
import { postProcessSessionTimeline } from "./sessionTimelinePostProcessor.js";
import { TemporalStateMachine } from "./temporalStateMachine.js";

const SESSION_STATES = Object.freeze({
  OUTSIDE_SESSION: "OUTSIDE_SESSION",
  READY: "READY",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  TRACKING_LOST: "TRACKING_LOST",
  SESSION_COMPLETE: "SESSION_COMPLETE"
});

const REPETITION_STATES = Object.freeze({
  WAITING: "WAITING",
  REP_STARTED: "REP_STARTED",
  REP_ACTIVE: "REP_ACTIVE",
  REP_COMPLETED: "REP_COMPLETED",
  REP_ABORTED: "REP_ABORTED"
});

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function cloneCorrectedTimeline(value) {
  return structuredClone(value);
}

function techniqueLabel(techniquePackage) {
  return techniquePackage.id.toUpperCase().replace(/-/g, "_");
}

export class TrackingSessionEngine {
  constructor(techniquePackage, { mode = "train", maximumFrames } = {}) {
    this.techniquePackage = techniquePackage;
    this.mode = mode;
    this.policy = techniquePackage.getMode(mode);
    this.maximumUnknownMovementMs =
      mode === "practice" ? 650 : 400;
    this.featureExtractor = new BiomechanicalFeatureExtractor();
    this.stateMachine = new TemporalStateMachine(techniquePackage, { mode });
    this.errorEvaluator = new PersistentErrorEvaluator(
      techniquePackage.errors.errors || []
    );
    this.timeline = new SessionTimelineRecorder({ maximumFrames });
    this.reset();
  }

  reset() {
    this.featureExtractor.reset();
    this.stateMachine.reset();
    this.errorEvaluator.reset();
    this.timeline.reset();
    this.sessionState = SESSION_STATES.OUTSIDE_SESSION;
    this.stateBeforeTrackingLoss = SESSION_STATES.READY;
    this.repState = REPETITION_STATES.WAITING;
    this.repId = null;
    this.repetitions = [];
    this.currentRepetition = null;
    this.sessionStartedAtMs = null;
    this.sessionEndedAtMs = null;
    this.lastTimestampMs = null;
    this.unknownStartedAtMs = null;
    this.pendingCue = null;
    this.stepDurations = new Map();
    this.lastStep = null;
    this.lastStepStartedAtMs = null;
    this.latestFrame = null;
    this.correctedSession = null;
  }

  start(timestampMs = null) {
    if (this.sessionState !== SESSION_STATES.OUTSIDE_SESSION) return;
    this.sessionState = SESSION_STATES.READY;
    this.sessionStartedAtMs = Number.isFinite(timestampMs) ? timestampMs : null;
    this.timeline.addEvent({
      type: "session_started",
      timestamp_ms: this.sessionStartedAtMs
    });
  }

  pause(timestampMs = this.lastTimestampMs) {
    if (![SESSION_STATES.READY, SESSION_STATES.ACTIVE].includes(this.sessionState)) {
      return;
    }
    this.sessionState = SESSION_STATES.PAUSED;
    this.timeline.addEvent({ type: "session_paused", timestamp_ms: timestampMs });
  }

  resume(timestampMs = this.lastTimestampMs) {
    if (this.sessionState !== SESSION_STATES.PAUSED) return;
    this.sessionState = this.stateMachine.currentState
      ? SESSION_STATES.ACTIVE
      : SESSION_STATES.READY;
    this.timeline.addEvent({ type: "session_resumed", timestamp_ms: timestampMs });
  }

  recordCue({ cue, timestampMs }) {
    if (!Number.isFinite(timestampMs)) return;
    this.pendingCue = { cue, timestamp_ms: timestampMs };
    this.timeline.addEvent({
      type: "cue_recorded",
      cue,
      timestamp_ms: timestampMs
    });
  }

  beginRepetition(timestampMs) {
    const repetition = this.repetitions.length + 1;
    this.repId = repetition;
    this.repState = REPETITION_STATES.REP_STARTED;
    this.currentRepetition = {
      rep_id: repetition,
      start_ms: timestampMs,
      end_ms: null,
      status: "active",
      state_confidences: [],
      form_errors: [],
      cue: this.pendingCue?.cue || null,
      cue_timestamp_ms: this.pendingCue?.timestamp_ms ?? null,
      response_time_ms: this.pendingCue
        ? Math.max(0, Math.round(timestampMs - this.pendingCue.timestamp_ms))
        : null
    };
    this.pendingCue = null;
    this.timeline.addEvent({
      type: "repetition_started",
      timestamp_ms: timestampMs,
      rep_id: repetition
    });
  }

  finishRepetition(timestampMs, status) {
    if (!this.currentRepetition) return;
    const repetition = this.currentRepetition;
    repetition.end_ms = timestampMs;
    repetition.duration_ms = Math.max(0, Math.round(timestampMs - repetition.start_ms));
    repetition.status = status;
    repetition.confidence = round(average(repetition.state_confidences));
    delete repetition.state_confidences;
    this.repetitions.push(repetition);
    this.currentRepetition = null;
    this.repState = status === "completed"
      ? REPETITION_STATES.REP_COMPLETED
      : REPETITION_STATES.REP_ABORTED;
    this.timeline.addEvent({
      type: status === "completed" ? "repetition_completed" : "repetition_aborted",
      timestamp_ms: timestampMs,
      rep_id: repetition.rep_id,
      reason: status === "completed" ? null : status
    });
  }

  updateStepDuration(step, timestampMs) {
    if (step === this.lastStep) return;
    if (this.lastStep && Number.isFinite(this.lastStepStartedAtMs)) {
      const durations = this.stepDurations.get(this.lastStep) || [];
      durations.push(Math.max(0, timestampMs - this.lastStepStartedAtMs));
      this.stepDurations.set(this.lastStep, durations);
    }
    this.lastStep = step;
    this.lastStepStartedAtMs = timestampMs;
  }

  update(level1State, sideOverrides = {}) {
    if (this.sessionState === SESSION_STATES.OUTSIDE_SESSION) this.start();
    if (
      this.sessionState === SESSION_STATES.PAUSED ||
      this.sessionState === SESSION_STATES.SESSION_COMPLETE
    ) {
      return this.latestFrame;
    }

    const extracted = this.featureExtractor.update(level1State, {
      leadSide: sideOverrides.leadSide || this.techniquePackage.manifest.default_side,
      kickSide: sideOverrides.kickSide || this.techniquePackage.manifest.default_side
    });
    if (!extracted) return this.latestFrame;
    return this.updateFeatures({
      ...extracted,
      timestamp: level1State.timestamp,
      evaluationContext: sideOverrides.evaluationContext || {}
    });
  }

  updateFeatures({
    timestampMs,
    timestamp = timestampMs / 1000,
    features = {},
    trackingConfidence = 1,
    evaluationContext = {}
  }) {
    if (
      this.sessionState === SESSION_STATES.PAUSED ||
      this.sessionState === SESSION_STATES.SESSION_COMPLETE
    ) {
      return this.latestFrame;
    }
    if (this.sessionState === SESSION_STATES.OUTSIDE_SESSION) this.start();
    this.sessionStartedAtMs ??= timestampMs;
    this.lastTimestampMs = timestampMs;

    const temporal = this.stateMachine.update({
      timestampMs,
      features,
      trackingConfidence
    });
    if (temporal.tracking_lost) {
      if (this.sessionState !== SESSION_STATES.TRACKING_LOST) {
        this.stateBeforeTrackingLoss = this.sessionState;
      }
      this.sessionState = SESSION_STATES.TRACKING_LOST;
    } else if (this.sessionState === SESSION_STATES.TRACKING_LOST) {
      this.sessionState = this.stateBeforeTrackingLoss === SESSION_STATES.ACTIVE
        ? SESSION_STATES.ACTIVE
        : SESSION_STATES.READY;
    }
    if (
      temporal.event?.type === "state_initialized" &&
      this.sessionState === SESSION_STATES.READY
    ) {
      this.sessionState = SESSION_STATES.ACTIVE;
    }

    const initialState = this.techniquePackage.manifest.initial_state;
    if (
      temporal.event?.type === "state_transition" &&
      temporal.event.from_state === initialState &&
      temporal.event.to_state !== initialState &&
      !this.currentRepetition
    ) {
      this.beginRepetition(timestampMs);
    } else if (this.currentRepetition) {
      this.repState = REPETITION_STATES.REP_ACTIVE;
    } else if (
      [REPETITION_STATES.REP_COMPLETED, REPETITION_STATES.REP_ABORTED]
        .includes(this.repState)
    ) {
      this.repState = REPETITION_STATES.WAITING;
      this.repId = null;
    }

    if (this.currentRepetition && temporal.confidence > 0) {
      this.currentRepetition.state_confidences.push(temporal.confidence);
    }
    if (temporal.event?.repetition_completed) {
      this.finishRepetition(timestampMs, "completed");
    } else if (
      temporal.event?.type === "state_timeout" &&
      this.currentRepetition
    ) {
      this.finishRepetition(timestampMs, "timeout");
    }

    if (temporal.unknown_movement) {
      this.unknownStartedAtMs ??= timestampMs;
      if (
        this.currentRepetition &&
        timestampMs - this.unknownStartedAtMs >= this.maximumUnknownMovementMs
      ) {
        this.finishRepetition(timestampMs, "unknown_movement");
        this.stateMachine.reset();
      }
    } else {
      this.unknownStartedAtMs = null;
    }

    const repetitionFeatures = {
      ...features,
      state_duration_ms: temporal.state_duration_ms,
      maximum_lead_elbow_angle: Math.max(
        features.lead_elbow_angle || 0,
        this.currentRepetition?.maximum_lead_elbow_angle || 0
      ),
      maximum_kick_knee_height: Math.max(
        features.kick_knee_height || 0,
        this.currentRepetition?.maximum_kick_knee_height || 0
      ),
      maximum_kick_knee_angle: Math.max(
        features.kick_knee_angle || 0,
        this.currentRepetition?.maximum_kick_knee_angle || 0
      ),
      minimum_recoil_knee_angle: Math.min(
        Number.isFinite(features.kick_knee_angle) ? features.kick_knee_angle : 180,
        this.currentRepetition?.minimum_recoil_knee_angle ?? 180
      )
    };
    if (this.currentRepetition) {
      Object.assign(this.currentRepetition, {
        maximum_lead_elbow_angle: repetitionFeatures.maximum_lead_elbow_angle,
        maximum_kick_knee_height: repetitionFeatures.maximum_kick_knee_height,
        maximum_kick_knee_angle: repetitionFeatures.maximum_kick_knee_angle,
        minimum_recoil_knee_angle: repetitionFeatures.minimum_recoil_knee_angle
      });
    }
    const errors = this.errorEvaluator.update({
      timestampMs,
      state: temporal.state,
      features: repetitionFeatures,
      trackingConfidence: temporal.tracking_lost ? 0 : trackingConfidence,
      evaluationContext
    });
    errors.events.forEach((event) => {
      this.timeline.addEvent(event);
      if (
        event.type === "form_error_detected" &&
        this.currentRepetition &&
        !this.currentRepetition.form_errors.includes(event.error_id)
      ) {
        this.currentRepetition.form_errors.push(event.error_id);
      }
    });

    this.updateStepDuration(temporal.state, timestampMs);
    const frame = {
      timestamp,
      timestamp_ms: timestampMs,
      session_state: this.sessionState,
      technique: techniqueLabel(this.techniquePackage),
      technique_version: this.techniquePackage.version,
      mode: this.mode,
      rep_id: this.repId,
      rep_state: this.repState,
      step: temporal.state,
      phase: temporal.phase,
      confidence: temporal.confidence,
      tracking_confidence: trackingConfidence,
      tracking_lost: temporal.tracking_lost,
      unknown_movement: temporal.unknown_movement,
      form_errors: errors.active_errors.map((error) => error.error_id),
      cue_timing_ms:
        this.currentRepetition?.response_time_ms ??
        (
          [REPETITION_STATES.REP_COMPLETED, REPETITION_STATES.REP_ABORTED]
            .includes(this.repState)
            ? this.repetitions[this.repetitions.length - 1]?.response_time_ms
            : null
        ) ??
        null,
      rule_evidence: temporal.rule_evidence,
      temporal_event: temporal.event
    };
    this.timeline.record(frame);
    this.latestFrame = frame;
    return frame;
  }

  end(timestampMs = this.lastTimestampMs) {
    if (this.sessionState === SESSION_STATES.SESSION_COMPLETE) {
      return this.getSummary({ includeTimeline: true });
    }
    if (this.currentRepetition && Number.isFinite(timestampMs)) {
      this.finishRepetition(timestampMs, "session_ended");
    }
    this.updateStepDuration(null, timestampMs);
    this.timeline.close(timestampMs);
    this.sessionEndedAtMs = timestampMs;
    this.sessionState = SESSION_STATES.SESSION_COMPLETE;
    this.timeline.addEvent({
      type: "session_completed",
      timestamp_ms: timestampMs
    });
    if (this.policy.post_session_correction) {
      this.correctedSession = postProcessSessionTimeline({
        frames: this.timeline.frames,
        techniquePackage: this.techniquePackage,
        config: {
          maximum_repairable_tracking_gap_ms:
            this.policy.maximum_repairable_tracking_gap_ms,
          maximum_unknown_movement_ms: this.maximumUnknownMovementMs
        }
      });
    }
    return this.getSummary({ includeTimeline: true });
  }

  getSummary({ includeTimeline = false } = {}) {
    const completed = this.repetitions.filter(
      (repetition) => repetition.status === "completed"
    );
    const aborted = this.repetitions.filter(
      (repetition) => repetition.status !== "completed"
    );
    const errors = this.errorEvaluator.getOccurrences();
    const errorCounts = errors.reduce((counts, error) => ({
      ...counts,
      [error.error_id]: (counts[error.error_id] || 0) + 1
    }), {});
    const responseTimes = completed
      .map((repetition) => repetition.response_time_ms)
      .filter(Number.isFinite);
    const frameTracking = this.timeline.frames.map(
      (frame) => frame.tracking_confidence
    );
    const corrected = this.correctedSession;
    const correctedSummary = corrected?.summary;
    const summary = {
      session_state: this.sessionState,
      technique: techniqueLabel(this.techniquePackage),
      technique_version: this.techniquePackage.version,
      mode: this.mode,
      session_started_at_ms: this.sessionStartedAtMs,
      session_ended_at_ms: this.sessionEndedAtMs,
      total_repetitions:
        correctedSummary?.total_repetitions ?? this.repetitions.length,
      completed_repetitions:
        correctedSummary?.completed_repetitions ?? completed.length,
      aborted_repetitions:
        correctedSummary?.aborted_repetitions ?? aborted.length,
      average_accuracy:
        correctedSummary?.average_accuracy ??
        round(average(completed.map((repetition) => repetition.confidence))),
      average_response_time_ms:
        correctedSummary?.average_response_time_ms ??
        (
          responseTimes.length
            ? Math.round(average(responseTimes))
            : null
        ),
      per_step_duration_ms:
        correctedSummary?.per_step_duration_ms ??
        Object.fromEntries(
          [...this.stepDurations.entries()].map(([step, durations]) => [
            step,
            Math.round(average(durations))
          ])
        ),
      common_form_errors:
        correctedSummary?.common_form_errors ??
        Object.entries(errorCounts)
          .map(([error_id, count]) => ({ error_id, count }))
          .sort((first, second) => second.count - first.count),
      tracking_quality_percentage:
        correctedSummary?.tracking_quality_percentage ??
        round(average(frameTracking) * 100),
      repetitions: corrected
        ? corrected.repetitions.map((repetition) => ({ ...repetition }))
        : this.repetitions.map((repetition) => ({ ...repetition })),
      post_session_corrected: Boolean(corrected),
      corrections_applied: correctedSummary?.corrections_applied ?? 0
    };
    if (includeTimeline) {
      summary.raw_timeline = this.timeline.getTimeline();
      summary.corrected_timeline = corrected ? cloneCorrectedTimeline(corrected) : null;
    }
    return summary;
  }
}

export { REPETITION_STATES, SESSION_STATES };
