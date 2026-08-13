import { useMemo } from "react";

import {
  buildExpectedPose,
  projectExpectedPose
} from "../utils/buildExpectedPose";

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
  ["ankle_left", "foot_left"],
  ["hip_right", "knee_right"],
  ["knee_right", "ankle_right"],
  ["ankle_right", "foot_right"]
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
  referencePose = null,
  requiredParts = [],
  stepName = "",
  viewDegrees = 30
}) {
  const pose = useMemo(() => {
    if (!referencePose?.landmarks) return buildExpectedPose(requiredParts, stepName);
    const radians = viewDegrees * Math.PI / 180;
    const rotated = Object.fromEntries(Object.entries(referencePose.landmarks).map(([name, point]) => {
      const x = Number(point[0]); const y = Number(point[1]); const z = Number(point[2]);
      return [name, { x: x * Math.cos(radians) + z * Math.sin(radians), y }];
    }));
    const values = Object.values(rotated);
    const minX = Math.min(...values.map((point) => point.x)); const maxX = Math.max(...values.map((point) => point.x));
    const minY = Math.min(...values.map((point) => point.y)); const maxY = Math.max(...values.map((point) => point.y));
    const scale = Math.min(72 / Math.max(.001, maxX - minX), 108 / Math.max(.001, maxY - minY));
    const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
    return Object.fromEntries(Object.entries(rotated).map(([name, point]) => [name, {
      x: 50 + (point.x - centerX) * scale,
      y: 56 - (point.y - centerY) * scale
    }]));
  }, [referencePose, requiredParts, stepName, viewDegrees]);
  const projectedPose = useMemo(
    () => referencePose?.landmarks
      ? Object.fromEntries(Object.entries(pose).map(([name, point]) => [name, { ...point, x: mirrored ? 100 - point.x : point.x }]))
      : projectExpectedPose(pose, viewDegrees, mirrored),
    [mirrored, pose, referencePose, viewDegrees]
  );

  if (!requiredParts.length && !referencePose?.landmarks) return null;

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
        <g data-mirrored={mirrored ? "true" : "false"}>
          {CONNECTIONS.map(([fromName, toName]) => {
            const from = projectedPose[fromName];
            const to = projectedPose[toName];
            if (!from || !to) return null;
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
    </aside>
  );
}
