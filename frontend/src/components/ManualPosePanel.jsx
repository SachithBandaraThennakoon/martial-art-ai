import { useState } from "react";
import PoseRangeDesigner from "./PoseRangeDesigner";

export default function ManualPosePanel({ step, onApplyManualPose, onManualPoseChange }) {
  const [message, setMessage] = useState("");

  const apply = (angleTargets, referencePose) => {
    onApplyManualPose({ angleTargets, referencePose });
    setMessage("Manual pose applied to this step draft. Use Save to persist the catalog data.");
  };

  return <section className="manual-pose-panel">
    {message ? <p className="pose-optimization__message" role="status">{message}</p> : null}
    <PoseRangeDesigner
      key={step.step_number}
      emitInitialPoseChange={false}
      initialAngleTolerance={3}
      onApply={apply}
      onPoseChange={onManualPoseChange}
      rangeTargets={step.angle_targets || []}
      referencePose={step.reference_pose || null}
    />
  </section>;
}
