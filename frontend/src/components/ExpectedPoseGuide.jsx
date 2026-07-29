import { useMemo } from "react";

import { buildExpectedPose } from "../utils/buildExpectedPose";

const CONNECTIONS = [
  ["head", "shoulder_left"],
  ["head", "shoulder_right"],
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

const VIEW_OPTIONS = [
  { label: "Front", value: 0 },
  { label: "30°", value: 30 },
  { label: "45°", value: 45 },
  { label: "Side", value: 90 }
];

export default function ExpectedPoseGuide({
  mirrored = false,
  onViewChange,
  requiredParts = [],
  stepName = "",
  viewDegrees = 30
}) {
  const pose = useMemo(
    () => buildExpectedPose(requiredParts, stepName),
    [requiredParts, stepName]
  );
  const qualityCues = requiredParts.filter((target) => target.feature);
  const projectedPose = useMemo(() => {
    const turn = Math.min(90, Math.max(0, viewDegrees)) / 90;
    const widthScale = 1 - turn * 0.18;

    return Object.fromEntries(
      Object.entries(pose).map(([name, point]) => {
        const isLeft = name.endsWith("_left");
        const isRight = name.endsWith("_right");
        const depthDirection = isLeft ? -1 : isRight ? 1 : 0;
        const isTorsoJoint = /shoulder|hip/.test(name);
        const convergence = isTorsoJoint ? depthDirection * -3.5 * turn : 0;
        const depthDrop = depthDirection * 3 * turn;

        return [
          name,
          {
            x: 50 + (point.x - 50) * widthScale + convergence,
            y: point.y + depthDrop
          }
        ];
      })
    );
  }, [pose, viewDegrees]);
  const mirrorTransform = mirrored ? "translate(100 0) scale(-1 1)" : undefined;

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
        <g transform={mirrorTransform}>
          {CONNECTIONS.map(([fromName, toName]) => {
            const from = projectedPose[fromName];
            const to = projectedPose[toName];
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
          {Object.entries(projectedPose).map(([name, point]) => (
            <circle cx={point.x} cy={point.y} key={name} r="1.8" />
          ))}
        </g>
      </svg>
      {onViewChange ? (
        <div className="expected-pose-guide__views" aria-label="Choose camera angle">
          {VIEW_OPTIONS.map((option) => (
            <button
              aria-pressed={viewDegrees === option.value}
              className={viewDegrees === option.value ? "is-active" : ""}
              key={option.value}
              onClick={() => onViewChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {qualityCues.length ? (
        <div className="expected-pose-guide__quality">
          {qualityCues.slice(0, 4).map((target) => (
            <span key={target.feature}>{target.label}</span>
          ))}
        </div>
      ) : null}
      <small>Bone guide · match the shape, not body size</small>
    </aside>
  );
}
