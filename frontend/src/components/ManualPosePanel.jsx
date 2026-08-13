import { useState } from "react";
import PoseRangeDesigner from "./PoseRangeDesigner";

export default function ManualPosePanel({
  step,
  stepIndex,
  steps,
  transitionTarget,
  onApplyManualPose,
  onManualPoseChange,
  onReuseEarlierStep,
  onStepSelect,
  onTransitionDurationChange,
}) {
  const [message, setMessage] = useState("");
  const reusableSteps = steps
    .slice(0, stepIndex)
    .map((candidate, index) => ({ ...candidate, sourceIndex: index }))
    .filter((candidate) => candidate.reference_pose);
  const [sourceStepIndex, setSourceStepIndex] = useState(
    reusableSteps.at(-1)?.sourceIndex ?? "",
  );

  const apply = (angleTargets, referencePose) => {
    onApplyManualPose({ angleTargets, referencePose });
    setMessage("Manual pose applied to this step draft. Use Save to persist the catalog data.");
  };

  return <section className="manual-pose-panel">
    {message ? <p className="manual-pose-panel__message" role="status">{message}</p> : null}
    {stepIndex > 0 ? (
      <div className="manual-pose-panel__reuse">
        <div>
          <strong>Reuse earlier step</strong>
          <span>Copy its complete pose and ranges, then edit only what changes.</span>
        </div>
        <label>
          <span>Source</span>
          <select
            disabled={!reusableSteps.length}
            onChange={(event) => setSourceStepIndex(Number(event.target.value))}
            value={sourceStepIndex}
          >
            {!reusableSteps.length ? <option value="">No earlier saved pose</option> : null}
            {reusableSteps.map((candidate) => (
              <option key={candidate.step_number} value={candidate.sourceIndex}>
                Step {candidate.sourceIndex + 1} · {candidate.step_name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn--ghost btn--small"
          disabled={sourceStepIndex === ""}
          onClick={() => onReuseEarlierStep(sourceStepIndex, stepIndex)}
          title="Replace this step's pose, articulation, tolerances, and angle ranges"
          type="button"
        >
          Apply to Step {stepIndex + 1}
        </button>
      </div>
    ) : null}
    <PoseRangeDesigner
      key={step.step_number}
      emitInitialPoseChange={false}
      initialAngleTolerance={3}
      onApply={apply}
      onPoseChange={onManualPoseChange}
      rangeTargets={step.angle_targets || []}
      referencePose={step.reference_pose || null}
      timelineStepIndex={stepIndex}
      timelineSteps={steps}
      transitionTarget={transitionTarget}
      transitionDurationMs={step.transition_duration_ms}
      onTimelineStepSelect={onStepSelect}
      onTransitionDurationChange={(value) =>
        onTransitionDurationChange(stepIndex, value)
      }
    />
  </section>;
}
