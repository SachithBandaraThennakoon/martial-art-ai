const DEFAULT_CONFIG = {
  correctQualityThreshold: 0.72,
  validQualityThreshold: 0.45,
  maxCueLeadMs: 5000
};

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

function classifyCorrectness(quality, peakTimestampMs, config) {
  if (!Number.isFinite(peakTimestampMs) || quality < config.validQualityThreshold) {
    return "incorrect";
  }
  return quality >= config.correctQualityThreshold ? "correct" : "needs_review";
}

export class RepetitionSessionLedger {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.startedAtMs = null;
    this.endedAtMs = null;
    this.currentRepetition = null;
    this.repetitions = [];
    this.cues = [];
    this.seenEventIds = new Set();
    this.lastTimestampMs = null;
  }

  recordCue({ cue, timestampMs }) {
    if (!Number.isFinite(timestampMs)) return null;
    const existing = this.cues.find((item) => item.cue === cue);
    if (existing) return existing;

    const marker = {
      cue,
      timestamp_ms: timestampMs,
      matched_repetition: null
    };
    this.cues.push(marker);
    this.cues.sort((first, second) => first.timestamp_ms - second.timestamp_ms);
    return marker;
  }

  findCue(timestampMs) {
    return [...this.cues]
      .reverse()
      .find((cue) =>
        cue.matched_repetition === null &&
        cue.timestamp_ms <= timestampMs &&
        timestampMs - cue.timestamp_ms <= this.config.maxCueLeadMs
      ) || null;
  }

  startRepetition(timestampMs, techniqueName) {
    if (this.currentRepetition) return;
    const cue = this.findCue(timestampMs);
    const repetitionNumber = this.repetitions.length + 1;
    if (cue) cue.matched_repetition = repetitionNumber;

    this.currentRepetition = {
      repetition: repetitionNumber,
      technique_name: techniqueName || null,
      start_ms: timestampMs,
      response_onset_ms: timestampMs,
      peak_ms: null,
      end_ms: null,
      cue: cue?.cue ?? null,
      count_cue_ms: cue?.timestamp_ms ?? null,
      reaction_time_ms: cue ? Math.round(timestampMs - cue.timestamp_ms) : null,
      steps: [],
      samples: []
    };
  }

  observe({
    timestampMs,
    event,
    phase,
    stepId,
    stepName,
    stepProbability,
    mistakeRisk,
    trackingConfidence,
    techniqueName
  }) {
    if (!Number.isFinite(timestampMs)) return this.getSummary();
    this.startedAtMs ??= timestampMs;
    this.lastTimestampMs = timestampMs;

    const isNewEvent = event?.id && !this.seenEventIds.has(event.id);
    if (isNewEvent) this.seenEventIds.add(event.id);

    if (
      !this.currentRepetition &&
      isNewEvent &&
      ["movement_onset", "step_entry", "peak_extension"].includes(event.type)
    ) {
      this.startRepetition(timestampMs, techniqueName);
    }

    if (this.currentRepetition) {
      this.currentRepetition.samples.push({
        timestamp_ms: timestampMs,
        phase: phase || null,
        step_probability: Number(stepProbability) || 0,
        mistake_risk: Number(mistakeRisk) || 0,
        tracking_confidence: Number(trackingConfidence) || 0
      });
      this.currentRepetition.samples = this.currentRepetition.samples.slice(-600);

      if (
        isNewEvent &&
        ["step_entry", "peak_extension"].includes(event.type) &&
        !this.currentRepetition.steps.some((step) => step.step_id === stepId)
      ) {
        this.currentRepetition.steps.push({
          step_id: stepId,
          step_name: stepName || null,
          entry_ms: timestampMs
        });
      }
      if (isNewEvent && event.type === "peak_extension") {
        this.currentRepetition.peak_ms = timestampMs;
      }
      if (isNewEvent && event.type === "repetition_end_candidate") {
        this.completeRepetition(timestampMs);
      }
    }

    return this.getSummary();
  }

  completeRepetition(timestampMs) {
    if (!this.currentRepetition) return null;
    const repetition = this.currentRepetition;
    const quality = average(
      repetition.samples.map((sample) =>
        sample.step_probability *
        (1 - sample.mistake_risk) *
        sample.tracking_confidence
      )
    );
    repetition.end_ms = timestampMs;
    repetition.duration_ms = Math.round(timestampMs - repetition.start_ms);
    repetition.form_quality = round(quality);
    repetition.correctness = classifyCorrectness(quality, repetition.peak_ms, this.config);
    repetition.complete = Number.isFinite(repetition.peak_ms);
    repetition.sample_count = repetition.samples.length;
    delete repetition.samples;
    this.repetitions.push(repetition);
    this.currentRepetition = null;
    return repetition;
  }

  endSession(timestampMs = this.lastTimestampMs) {
    if (this.currentRepetition && Number.isFinite(timestampMs)) {
      const repetition = this.currentRepetition;
      repetition.end_ms = timestampMs;
      repetition.duration_ms = Math.round(timestampMs - repetition.start_ms);
      repetition.form_quality = round(average(
        repetition.samples.map((sample) =>
          sample.step_probability *
          (1 - sample.mistake_risk) *
          sample.tracking_confidence
        )
      ));
      repetition.correctness = "incomplete";
      repetition.complete = false;
      repetition.sample_count = repetition.samples.length;
      delete repetition.samples;
      this.repetitions.push(repetition);
      this.currentRepetition = null;
    }
    this.endedAtMs = timestampMs;
    return this.getSummary();
  }

  getSummary() {
    const completed = this.repetitions.filter((repetition) => repetition.complete);
    const correct = completed.filter((repetition) => repetition.correctness === "correct");
    const reactionTimes = completed
      .map((repetition) => repetition.reaction_time_ms)
      .filter(Number.isFinite);
    const qualities = completed.map((repetition) => repetition.form_quality);

    return {
      session_started_at_ms: this.startedAtMs,
      session_ended_at_ms: this.endedAtMs,
      session_duration_ms: Number.isFinite(this.startedAtMs) && Number.isFinite(this.lastTimestampMs)
        ? Math.round((this.endedAtMs ?? this.lastTimestampMs) - this.startedAtMs)
        : 0,
      repetitions_detected: this.repetitions.length,
      repetitions_completed: completed.length,
      correct_repetitions: correct.length,
      incomplete_repetitions: this.repetitions.length - completed.length,
      average_form_quality: round(average(qualities)),
      average_reaction_time_ms: reactionTimes.length
        ? Math.round(average(reactionTimes))
        : null,
      unmatched_cues: this.cues.filter((cue) => cue.matched_repetition === null).length,
      active_repetition: this.currentRepetition
        ? {
            repetition: this.currentRepetition.repetition,
            start_ms: this.currentRepetition.start_ms,
            peak_ms: this.currentRepetition.peak_ms,
            cue: this.currentRepetition.cue,
            reaction_time_ms: this.currentRepetition.reaction_time_ms,
            steps_detected: this.currentRepetition.steps.length
          }
        : null,
      latest_repetition: this.repetitions[this.repetitions.length - 1] || null,
      repetitions: this.repetitions.map((repetition) => ({ ...repetition }))
    };
  }
}
