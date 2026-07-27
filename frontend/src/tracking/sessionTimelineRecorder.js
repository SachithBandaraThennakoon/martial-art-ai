function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class SessionTimelineRecorder {
  constructor({ maximumFrames = 108000 } = {}) {
    this.maximumFrames = maximumFrames;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.events = [];
    this.trackingLossIntervals = [];
    this.openTrackingLoss = null;
    this.previousStep = null;
    this.previousPhase = null;
  }

  addEvent(event) {
    if (!event) return;
    this.events.push(clone(event));
  }

  record(frame) {
    if (!frame || !Number.isFinite(frame.timestamp_ms)) return;

    if (frame.tracking_lost && !this.openTrackingLoss) {
      this.openTrackingLoss = {
        start_ms: frame.timestamp_ms,
        end_ms: null,
        duration_ms: null
      };
      this.addEvent({
        type: "tracking_lost",
        timestamp_ms: frame.timestamp_ms
      });
    } else if (!frame.tracking_lost && this.openTrackingLoss) {
      this.openTrackingLoss.end_ms = frame.timestamp_ms;
      this.openTrackingLoss.duration_ms =
        frame.timestamp_ms - this.openTrackingLoss.start_ms;
      this.trackingLossIntervals.push(this.openTrackingLoss);
      this.addEvent({
        type: "tracking_recovered",
        timestamp_ms: frame.timestamp_ms,
        interval: clone(this.openTrackingLoss)
      });
      this.openTrackingLoss = null;
    }

    if (frame.step !== this.previousStep) {
      this.addEvent({
        type: "step_boundary",
        timestamp_ms: frame.timestamp_ms,
        from_step: this.previousStep,
        to_step: frame.step
      });
      this.previousStep = frame.step;
    }
    if (frame.phase !== this.previousPhase) {
      this.addEvent({
        type: "phase_boundary",
        timestamp_ms: frame.timestamp_ms,
        from_phase: this.previousPhase,
        to_phase: frame.phase
      });
      this.previousPhase = frame.phase;
    }

    this.frames.push(clone(frame));
    if (this.frames.length > this.maximumFrames) {
      this.frames.splice(0, this.frames.length - this.maximumFrames);
    }
  }

  close(timestampMs) {
    if (this.openTrackingLoss && Number.isFinite(timestampMs)) {
      this.openTrackingLoss.end_ms = timestampMs;
      this.openTrackingLoss.duration_ms =
        timestampMs - this.openTrackingLoss.start_ms;
      this.trackingLossIntervals.push(this.openTrackingLoss);
      this.openTrackingLoss = null;
    }
  }

  getTimeline() {
    return {
      frames: this.frames.map(clone),
      events: this.events.map(clone),
      tracking_loss_intervals: this.trackingLossIntervals.map(clone)
    };
  }
}
