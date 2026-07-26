const DEFAULT_CONFIG = {
  minTrackingConfidence: 0.55,
  idleMotionThreshold: 0.018,
  activeMotionThreshold: 0.035,
  stepEntryThreshold: 0.68,
  peakThreshold: 0.82,
  recoveryStepThreshold: 0.58,
  stableFrames: 2,
  boundaryThreshold: 0.58
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function normalizeStepLabel(stepId) {
  if (stepId === null || stepId === undefined || stepId === "") return "step";
  return `step_${String(stepId).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function distributionChange(current, previous) {
  if (!previous) return 0;
  return Math.max(
    Math.abs(current.step - previous.step),
    Math.abs(current.mistake - previous.mistake),
    Math.abs(current.tracking - previous.tracking)
  );
}

function inferCandidate({
  trackingConfidence,
  motionEnergy,
  stepProbability,
  previousMotionEnergy,
  previousPhase
}, config) {
  if (trackingConfidence < config.minTrackingConfidence) return "tracking_lost";
  if (
    motionEnergy < config.idleMotionThreshold &&
    stepProbability < config.recoveryStepThreshold
  ) {
    return previousPhase === "peak_extension" || previousPhase === "step_active"
      ? "recovery"
      : "idle";
  }
  if (
    stepProbability >= config.peakThreshold &&
    previousMotionEnergy > motionEnergy
  ) {
    return "peak_extension";
  }
  if (stepProbability >= config.stepEntryThreshold) return "step_active";
  if (motionEnergy >= config.activeMotionThreshold) return "preparation";
  if (previousPhase === "peak_extension" || previousPhase === "step_active") {
    return "recovery";
  }
  return "unknown";
}

function eventForTransition(previous, current) {
  if (!previous || previous === current) return null;
  if (current === "tracking_lost") return "tracking_lost";
  if (previous === "tracking_lost") return "tracking_recovered";
  if (current === "preparation") return "movement_onset";
  if (current === "step_active") return "step_entry";
  if (current === "peak_extension") return "peak_extension";
  if (current === "recovery") return "recovery_onset";
  if (current === "idle" && previous === "recovery") return "repetition_end_candidate";
  return "phase_transition";
}

export class ActionSegmentationEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.phase = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.previousMotionEnergy = 0;
    this.previousFeatures = null;
    this.lastTimestampMs = null;
    this.segmentStartedAtMs = null;
    this.eventSequence = 0;
  }

  update({
    timestampMs,
    trackingConfidence = 0,
    motionEnergy = 0,
    stepProbability = 0,
    mistakeRisk = 0,
    currentStepId = null,
    currentStepName = ""
  }) {
    if (!Number.isFinite(timestampMs)) return null;

    const features = {
      step: clamp(stepProbability),
      mistake: clamp(mistakeRisk),
      tracking: clamp(trackingConfidence)
    };
    const phaseCandidate = inferCandidate({
      trackingConfidence: features.tracking,
      motionEnergy,
      stepProbability: features.step,
      previousMotionEnergy: this.previousMotionEnergy,
      previousPhase: this.phase
    }, this.config);

    if (phaseCandidate === this.candidate) {
      this.candidateFrames += 1;
    } else {
      this.candidate = phaseCandidate;
      this.candidateFrames = 1;
    }

    const energyChange = Math.abs(motionEnergy - this.previousMotionEnergy);
    const confidenceDrop = Math.max(
      0,
      (this.previousFeatures?.tracking || features.tracking) - features.tracking
    );
    const scoreChange = distributionChange(features, this.previousFeatures);
    const rawBoundaryScore = clamp(
      scoreChange * 0.5 +
      clamp(energyChange / Math.max(this.config.activeMotionThreshold, 0.001)) * 0.3 +
      confidenceDrop * 0.2
    );
    const mayCommit =
      this.phase === null ||
      phaseCandidate === "tracking_lost" ||
      this.candidateFrames >= this.config.stableFrames;
    const previousPhase = this.phase;
    const phaseChanged = mayCommit && phaseCandidate !== this.phase;

    if (phaseChanged) {
      this.phase = phaseCandidate;
      this.segmentStartedAtMs = timestampMs;
    }

    const eventType = phaseChanged ? eventForTransition(previousPhase, this.phase) : null;
    const event = eventType
      ? {
          id: `${Math.round(timestampMs)}:${this.eventSequence += 1}`,
          type: eventType,
          timestamp_ms: timestampMs,
          from_phase: previousPhase,
          to_phase: this.phase,
          confidence: round(Math.max(rawBoundaryScore, this.config.boundaryThreshold))
        }
      : null;
    const frameLabel =
      this.phase === "step_active" || this.phase === "peak_extension"
        ? normalizeStepLabel(currentStepId)
        : this.phase || "unknown";

    this.previousMotionEnergy = motionEnergy;
    this.previousFeatures = features;
    this.lastTimestampMs = timestampMs;

    return {
      frame_label: frameLabel,
      motion_phase: this.phase || "unknown",
      phase_confidence: round(
        this.phase === phaseCandidate
          ? Math.min(1, this.candidateFrames / this.config.stableFrames)
          : 0.5
      ),
      current_step_id: currentStepId,
      current_step_name: currentStepName || null,
      segment_started_at_ms: this.segmentStartedAtMs,
      segment_duration_ms: Math.max(0, timestampMs - (this.segmentStartedAtMs ?? timestampMs)),
      boundary: {
        candidate: rawBoundaryScore >= this.config.boundaryThreshold,
        probability: round(rawBoundaryScore),
        phase_changed: phaseChanged
      },
      change_point: {
        score: round(rawBoundaryScore),
        pose_score_change: round(scoreChange),
        motion_energy_change: round(energyChange),
        confidence_drop: round(confidenceDrop)
      },
      event
    };
  }
}
