import { useRef, useState } from "react";
import PoseRangeDesigner from "./PoseRangeDesigner";

export default function ManualPosePanel({
  step,
  stepIndex,
  steps,
  timelineCycle,
  transitionDurationMs,
  transitionTarget,
  onApplyManualPose,
  onManualPoseChange,
  onReuseEarlierStep,
  onStepSelect,
  onTransitionDurationChange,
}) {
  const [message, setMessage] = useState({ stepIndex: null, text: "" });
  const cameraViewRef = useRef(null);
  const reusableSteps = steps
    .slice(0, stepIndex)
    .map((candidate, index) => ({ ...candidate, sourceIndex: index }))
    .filter((candidate) => candidate.reference_pose);
  const [sourceSelection, setSourceSelection] = useState({
    stepIndex,
    value: reusableSteps.at(-1)?.sourceIndex ?? "",
  });
  const sourceStepIndex = sourceSelection.stepIndex === stepIndex
    ? sourceSelection.value
    : reusableSteps.at(-1)?.sourceIndex ?? "";
  const visibleMessage = message.stepIndex === stepIndex ? message.text : "";

  const apply = (angleTargets, referencePose) => {
    onApplyManualPose({ angleTargets, referencePose });
    setMessage({
      stepIndex,
      text: "Manual pose applied to this step draft. Use Save to persist the catalog data.",
    });
  };

  return <section className="manual-pose-panel">
    {visibleMessage ? <p className="manual-pose-panel__message" role="status">{visibleMessage}</p> : null}
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
            onChange={(event) => setSourceSelection({
              stepIndex,
              value: Number(event.target.value),
            })}
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
      cameraViewRef={cameraViewRef}
      emitInitialPoseChange={false}
      initialAngleTolerance={3}
      onApply={apply}
      onPoseChange={onManualPoseChange}
      rangeTargets={step.angle_targets || []}
      referencePose={step.reference_pose || null}
      strikingSide={step.striking_side || ""}
      strikingSurface={step.striking_surface || ""}
      timelineCycle={timelineCycle}
      timelineStepIndex={stepIndex}
      timelineSteps={steps}
      transitionTarget={transitionTarget}
      transitionDurationMs={transitionDurationMs ?? step.transition_duration_ms}
      onTimelineStepSelect={onStepSelect}
      onTransitionDurationChange={(value) =>
        onTransitionDurationChange(stepIndex, value)
      }
    />
  </section>;
}
