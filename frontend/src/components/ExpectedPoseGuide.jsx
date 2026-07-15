import { useMemo } from "react";

import { buildExpectedPose } from "../utils/buildExpectedPose";

const CONNECTIONS = [
  ["shoulder_left", "shoulder_right"],
  ["shoulder_left", "elbow_left"],
  ["elbow_left", "wrist_left"],
  ["shoulder_right", "elbow_right"],
  ["elbow_right", "wrist_right"],
  ["shoulder_left", "hip_left"],
  ["shoulder_right", "hip_right"],
  ["hip_left", "hip_right"],
  ["hip_left", "knee_left"],
  ["knee_left", "ankle_left"],
  ["hip_right", "knee_right"],
  ["knee_right", "ankle_right"]
];

export default function ExpectedPoseGuide({ mirrored = false, requiredParts = [], stepName = "" }) {
  const pose = useMemo(
    () => buildExpectedPose(requiredParts, stepName),
    [requiredParts, stepName]
  );

  if (!requiredParts.length) return null;

  return (
    <aside className="expected-pose-guide" aria-label={`Expected body shape for ${stepName || "this step"}`}>
      <div className="expected-pose-guide__head">
        <span>Target shape</span>
        <strong>{stepName || "Current step"}</strong>
      </div>
      <svg
        aria-hidden="true"
        className="expected-pose-guide__figure"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 -8 100 132"
      >
        <g transform={mirrored ? "translate(100 0) scale(-1 1)" : undefined}>
          {CONNECTIONS.map(([fromName, toName]) => {
            const from = pose[fromName];
            const to = pose[toName];
            return (
              <line
                key={`${fromName}-${toName}`}
                x1={from.x}
                x2={to.x}
                y1={from.y}
                y2={to.y}
              />
            );
          })}
          {Object.entries(pose).map(([name, point]) => (
            <circle cx={point.x} cy={point.y} key={name} r="1.8" />
          ))}
        </g>
      </svg>
      <small>Bone guide · match the shape, not body size</small>
    </aside>
  );
}
