import { useState } from "react";
import PoseRangeDesigner from "./PoseRangeDesigner";

export default function ManualPosePanel({ step, onApplyManualPose, onManualPoseChange }) {
  const [message, setMessage] = useState("");

  const apply = (angleTargets, referencePose) => {
    onApplyManualPose({ angleTargets, referencePose });
    setMessage("Manual pose applied to this step draft. Use Save to persist the catalog data.");
  };

  return <section className="manual-pose-panel">
    <header className="manual-pose-panel__heading">
      <div>
        <span className="catalog-admin__eyebrow">Manual pose authoring</span>
        <h3>{step.step_name}</h3>
        <p>Move joints, rotate limbs, or enter exact angles and XYZ positions. Changes sync to the draft automatically; use Save to persist them.</p>
      </div>
      <span className={`catalog-admin__step-pose-status ${step.reference_pose ? "has-pose" : "no-pose"}`}>
        {step.reference_pose ? "Pose available in draft" : "No pose in draft"}
      </span>
    </header>
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
