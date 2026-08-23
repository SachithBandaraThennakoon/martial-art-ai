/* eslint-disable react-refresh/only-export-components -- shared 3D pose primitives are consumed by the guide viewer */
import { Canvas, useThree } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Line,
  OrbitControls,
  TransformControls,
} from "@react-three/drei";
import {
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { buildFootLandmarks } from "../skeleton/footLandmarks";
import {
  buildTechniqueTimeline,
  timelineFrameAt,
} from "../utils/techniqueTimeline";
import PoseStudioContext from "./PoseStudioContext";
import MediaPipeSkeleton3D from "./MediaPipeSkeleton3D";
import { manualPoseToMediaPipePreview } from "../skeleton/manualPoseAdapter";
import { buildHandLandmarks } from "../skeleton/handLandmarks";
import { createAnatomicalDefaultPose } from "../skeleton/bodyProportions";

const DEFAULT_POSE = createAnatomicalDefaultPose();
const LINKS = [
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
  ["ankle_right", "foot_right"],
];
const ANGLES = [
  ["elbow_left", "Left elbow", "shoulder_left", "elbow_left", "wrist_left"],
  [
    "elbow_right",
    "Right elbow",
    "shoulder_right",
    "elbow_right",
    "wrist_right",
  ],
  ["shoulder_left", "Left shoulder", "elbow_left", "shoulder_left", "hip_left"],
  [
    "shoulder_right",
    "Right shoulder",
    "elbow_right",
    "shoulder_right",
    "hip_right",
  ],
  ["hip_left", "Left hip", "shoulder_left", "hip_left", "knee_left"],
  ["hip_right", "Right hip", "shoulder_right", "hip_right", "knee_right"],
  ["knee_left", "Left knee", "hip_left", "knee_left", "ankle_left"],
  ["knee_right", "Right knee", "hip_right", "knee_right", "ankle_right"],
  ["ankle_left", "Left ankle", "knee_left", "ankle_left", "foot_left"],
  ["ankle_right", "Right ankle", "knee_right", "ankle_right", "foot_right"],
];
const ANATOMICAL_ANGLE_LIMITS = {
  elbow_left: { min: 15, max: 178 },
  elbow_right: { min: 15, max: 178 },
  shoulder_left: { min: 10, max: 175 },
  shoulder_right: { min: 10, max: 175 },
  hip_left: { min: 20, max: 175 },
  hip_right: { min: 20, max: 175 },
  knee_left: { min: 20, max: 178 },
  knee_right: { min: 20, max: 178 },
  ankle_left: { min: 50, max: 140 },
  ankle_right: { min: 50, max: 140 },
};
function anatomicalLimits(bodyPart) {
  return ANATOMICAL_ANGLE_LIMITS[bodyPart] || { min: 0, max: 180 };
}
function clampAnatomicalAngle(bodyPart, value) {
  const limits = anatomicalLimits(bodyPart);
  return Math.max(limits.min, Math.min(limits.max, value));
}
const JOINT_LABELS = {
  head: "Head",
  shoulder_left: "Left shoulder",
  shoulder_right: "Right shoulder",
  elbow_left: "Left elbow",
  elbow_right: "Right elbow",
  wrist_left: "Left hand (wrist)",
  wrist_right: "Right hand (wrist)",
  hip_left: "Left hip",
  hip_right: "Right hip",
  knee_left: "Left knee",
  knee_right: "Right knee",
  ankle_left: "Left ankle",
  ankle_right: "Right ankle",
  foot_left: "Left foot endpoint",
  foot_right: "Right foot endpoint",
};
const POSITION_GROUPS = [
  {
    label: "Head and torso",
    joints: [
      "head",
      "shoulder_left",
      "shoulder_right",
      "hip_left",
      "hip_right",
    ],
  },
  {
    label: "Arms and hands",
    joints: ["elbow_left", "wrist_left", "elbow_right", "wrist_right"],
  },
  {
    label: "Legs and feet",
    joints: [
      "knee_left",
      "ankle_left",
      "foot_left",
      "knee_right",
      "ankle_right",
      "foot_right",
    ],
  },
];
function jointLabel(name) {
  return JOINT_LABELS[name] || name.replaceAll("_", " ");
}
const PARENT_JOINTS = {
  head: "shoulder_left",
  shoulder_left: "hip_left",
  shoulder_right: "shoulder_left",
  elbow_left: "shoulder_left",
  wrist_left: "elbow_left",
  hip_right: "hip_left",
  knee_left: "hip_left",
  ankle_left: "knee_left",
  foot_left: "ankle_left",
  knee_right: "hip_right",
  ankle_right: "knee_right",
  foot_right: "ankle_right",
};
const CHILD_JOINTS = Object.entries(PARENT_JOINTS).reduce(
  (children, [joint, parent]) => ({
    ...children,
    [parent]: [...(children[parent] || []), joint],
  }),
  {},
);
function jointBranchContains(rootJoint, targetJoint) {
  if (rootJoint === targetJoint) return true;
  return (CHILD_JOINTS[rootJoint] || []).some((child) =>
    jointBranchContains(child, targetJoint),
  );
}
const BONE_LENGTHS = Object.fromEntries(
  Object.entries(PARENT_JOINTS).map(([joint, parent]) => [
    joint,
    Math.hypot(
      ...DEFAULT_POSE[joint].map(
        (value, index) => value - DEFAULT_POSE[parent][index],
      ),
    ),
  ]),
);
const LINK_LENGTHS = Object.fromEntries(
  LINKS.map(([first, second]) => [
    `${first}:${second}`,
    Math.hypot(
      ...DEFAULT_POSE[first].map(
        (value, index) => value - DEFAULT_POSE[second][index],
      ),
    ),
  ]),
);

function linkLengthsFromPose(pose) {
  if (!pose) return LINK_LENGTHS;
  return Object.fromEntries(
    LINKS.map(([first, second]) => [
      `${first}:${second}`,
      Math.hypot(
        ...pose[first].map(
          (value, index) => value - pose[second][index],
        ),
      ),
    ]),
  );
}
const ANGLE_JOINTS = Object.fromEntries(
  ANGLES.map(([id, , first, center, end]) => [id, { first, center, end }]),
);
const STUDIO_OFFSETS = {
  pose_a: [-2.35, 0, 0],
  optimal: [0, 0, 0],
  pose_b: [2.35, 0, 0],
};
const TWO_POSE_OFFSETS = { pose_a: [-1.45, 0, 0], optimal: [1.45, 0, 0] };
const FLOOR_Y = -1.75;
const FOOT_CONTACT_Y = FLOOR_Y + 0.135;
const AUTHORING_JOINT_RADIUS = 0.024;
const AUTHORING_WRIST_RADIUS = 0.019;
const DEFAULT_ARTICULATION = {
  face: {
    gaze_horizontal: 0,
    gaze_vertical: 0,
    eye_openness: 1,
    tension: 0.35,
    jaw_openness: 0,
  },
  hand_left: {
    fist_closure: 0,
    finger_spread: 1,
    palm_turn: 0,
    wrist_rotation: [0, 0, 0],
  },
  hand_right: {
    fist_closure: 0,
    finger_spread: 1,
    palm_turn: 0,
    wrist_rotation: [0, 0, 0],
  },
};
const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [17, 0],
];
const freshHandArticulation = () => ({
  fist_closure: 0,
  finger_spread: 1,
  palm_turn: 0,
  wrist_rotation: [0, 0, 0],
});

const finiteClamped = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
};

function normalizedArticulation(value) {
  const face = value?.face || {};
  const normalizeHand = (group) => {
    const hand = value?.[group] || {};
    const rotation = Array.isArray(hand.wrist_rotation)
      ? hand.wrist_rotation.slice(0, 3)
      : [];
    return {
      fist_closure: finiteClamped(hand.fist_closure, 0, 0, 1),
      finger_spread: finiteClamped(hand.finger_spread, 1, 0, 1),
      palm_turn: finiteClamped(hand.palm_turn, 0, 0, 1),
      wrist_rotation: [0, 1, 2].map((axis) =>
        finiteClamped(rotation[axis], 0, -Math.PI, Math.PI),
      ),
    };
  };
  return {
    face: Object.fromEntries(
      Object.entries(DEFAULT_ARTICULATION.face).map(([field, fallback]) => [
        field,
        finiteClamped(face[field], fallback, field.startsWith("gaze_") ? -1 : 0, 1),
      ]),
    ),
    hand_left: normalizeHand("hand_left"),
    hand_right: normalizeHand("hand_right"),
  };
}

function wristRotationsFromArticulation(value) {
  const articulation = normalizedArticulation(value);
  return {
    wrist_left: [...(articulation.hand_left.wrist_rotation || [0, 0, 0])],
    wrist_right: [...(articulation.hand_right.wrist_rotation || [0, 0, 0])],
  };
}

function freshPose() {
  return Object.fromEntries(
    Object.entries(DEFAULT_POSE).map(([name, position]) => [
      name,
      [...position],
    ]),
  );
}
function calculateAngle(first, center, last) {
  const left = first.map((value, index) => value - center[index]);
  const right = last.map((value, index) => value - center[index]);
  const denominator = Math.hypot(...left) * Math.hypot(...right);
  if (!denominator) return 0;
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      left.reduce((sum, value, index) => sum + value * right[index], 0) /
        denominator,
    ),
  );
  return Math.round((Math.acos(cosine) * 180) / Math.PI);
}

function groundPose(pose) {
  const lowestFoot = Math.min(pose.foot_left[1], pose.foot_right[1]);
  const offset = FOOT_CONTACT_Y - lowestFoot;
  if (Math.abs(offset) < 0.00001) return pose;
  return Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [
      name,
      [position[0], Number((position[1] + offset).toFixed(3)), position[2]],
    ]),
  );
}

function plantedFootName(pose) {
  return pose.foot_left[1] <= pose.foot_right[1] ? "foot_left" : "foot_right";
}

function restorePlantedFootAndResolve(
  nextPose,
  previousPose,
  fallbackPinnedJoint,
) {
  const plantedFoot = plantedFootName(previousPose);
  const moved =
    Math.hypot(
      ...nextPose[plantedFoot].map(
        (value, index) => value - previousPose[plantedFoot][index],
      ),
    ) > 0.0005;
  if (!moved) return enforceAllBoneLengths(nextPose, fallbackPinnedJoint);
  // Moving any joint in the planted foot's parent chain is an intentional
  // branch translation. Keep the ankle/heel/toe descendants with the knee or
  // hip instead of snapping the foot back to its previous world position.
  if (
    fallbackPinnedJoint &&
    jointBranchContains(fallbackPinnedJoint, plantedFoot)
  )
    return enforceAllBoneLengths(nextPose, fallbackPinnedJoint);
  const restored = {
    ...nextPose,
    [plantedFoot]: [...previousPose[plantedFoot]],
  };
  return enforceAllBoneLengths(restored, plantedFoot);
}

function poseFrame(pose) {
  const hipCenter = pose.hip_left.map(
    (value, index) => (value + pose.hip_right[index]) / 2,
  );
  const shoulderCenter = pose.shoulder_left.map(
    (value, index) => (value + pose.shoulder_right[index]) / 2,
  );
  return {
    origin: hipCenter,
    scale: Math.max(
      0.0001,
      Math.hypot(
        ...shoulderCenter.map((value, index) => value - hipCenter[index]),
      ),
    ),
  };
}

function referencePoseFromPose(
  pose,
  tolerance = 0.12,
  articulation = DEFAULT_ARTICULATION,
) {
  const { origin, scale } = poseFrame(pose);
  const landmarks = Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [
      name,
      position.map((value, index) =>
        Number(((value - origin[index]) / scale).toFixed(4)),
      ),
    ]),
  );
  return {
    schema_version: "1.0",
    coordinate_space: "body_normalized_v1",
    origin: "hip_center",
    scale_basis: "torso_length",
    tolerance: Number(tolerance.toFixed(3)),
    articulation: normalizedArticulation(articulation),
    landmarks,
    bones: LINKS.map(([from, to]) => ({
      from,
      to,
      length: Number(
        Math.hypot(
          ...landmarks[from].map(
            (value, index) => value - landmarks[to][index],
          ),
        ).toFixed(4),
      ),
    })),
  };
}

export function poseFromReferencePose(referencePose) {
  if (
    referencePose?.coordinate_space !== "body_normalized_v1" ||
    !referencePose.landmarks
  )
    return null;
  const canonical = freshPose();
  const { origin, scale } = poseFrame(canonical);
  const pose = { ...canonical };
  Object.entries(referencePose.landmarks).forEach(([name, position]) => {
    if (pose[name] && Array.isArray(position) && position.length === 3)
      pose[name] = position.map((value, index) =>
        Number((origin[index] + Number(value) * scale).toFixed(3)),
      );
  });
  // Preserve every supplied XYZ landmark exactly (apart from the uniform
  // body-normalized-to-studio transform). Re-solving bone lengths here would
  // change the angles, stance and rotations selected by the optimizer.
  return groundPose(pose);
}

function interpolateNumber(start, end, progress) {
  return start + (end - start) * progress;
}

function smoothProgress(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function interpolatePose(startPose, endPose, progress, targetLengths = LINK_LENGTHS) {
  const eased = smoothProgress(progress);
  const normalizedStart = groundPose(
    enforceAllBoneLengths(startPose, "hip_left", targetLengths),
  );
  const normalizedEnd = groundPose(
    enforceAllBoneLengths(endPose, "hip_left", targetLengths),
  );
  const blended = Object.fromEntries(
    Object.entries(normalizedStart).map(([name, position]) => [
      name,
      position.map((value, axis) =>
        interpolateNumber(value, normalizedEnd[name]?.[axis] ?? value, eased),
      ),
    ]),
  );
  // Cartesian interpolation can shorten a rotating limb halfway through the
  // move. Re-solving the rig keeps every preview frame anatomically stable.
  return groundPose(enforceAllBoneLengths(blended, "hip_left", targetLengths));
}

function interpolateWristRotation(start, end, progress) {
  const startQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...start, "XYZ"),
  );
  const endQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...end, "XYZ"),
  );
  // Euler components can cross ±π or describe the same orientation with very
  // different values. Slerp follows the shortest physical wrist rotation and
  // avoids the fist rolling independently around all three axes.
  const rotation = new THREE.Euler().setFromQuaternion(
    startQuaternion.slerp(endQuaternion, progress),
    "XYZ",
  );
  return [rotation.x, rotation.y, rotation.z];
}

export function interpolateArticulation(startValue, endValue, progress) {
  const start = normalizedArticulation(startValue);
  const end = normalizedArticulation(endValue);
  const eased = smoothProgress(progress);
  const interpolateGroup = (group) =>
    Object.fromEntries(
      Object.keys(start[group]).map((field) => {
        if (field === "wrist_rotation")
          return [
            field,
            interpolateWristRotation(
              start[group][field],
              end[group][field],
              eased,
            ),
          ];
        return [
          field,
          interpolateNumber(start[group][field], end[group][field], eased),
        ];
      }),
    );
  return {
    face: interpolateGroup("face"),
    hand_left: interpolateGroup("hand_left"),
    hand_right: interpolateGroup("hand_right"),
  };
}

function transitionBoundaryStatus(pose, startTargets, endTargets, progress) {
  const startByPart = Object.fromEntries(
    startTargets.map((target) => [target.body_part, target]),
  );
  const endByPart = Object.fromEntries(
    endTargets.map((target) => [target.body_part, target]),
  );
  const sharedTargets = ANGLES.flatMap(
    ([bodyPart, label, first, center, last]) => {
      const start = startByPart[bodyPart];
      const end = endByPart[bodyPart];
      if (!start || !end) return [];
      const eased = smoothProgress(progress);
      const minimum = interpolateNumber(Number(start.min), Number(end.min), eased);
      const maximum = interpolateNumber(Number(start.max), Number(end.max), eased);
      const angle = calculateAngle(pose[first], pose[center], pose[last]);
      return angle >= minimum - 0.5 && angle <= maximum + 0.5
        ? []
        : [{ bodyPart, label, angle, minimum, maximum }];
    },
  );
  return { checked: Object.keys(startByPart).filter((key) => endByPart[key]).length, violations: sharedTargets };
}

function enforceAllBoneLengths(pose, pinnedJoint, targetLengths = LINK_LENGTHS) {
  const next = Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [name, [...position]]),
  );
  for (let iteration = 0; iteration < 24; iteration += 1) {
    let maximumError = 0;
    LINKS.forEach(([first, second]) => {
      const firstPosition = next[first];
      const secondPosition = next[second];
      const difference = secondPosition.map(
        (value, index) => value - firstPosition[index],
      );
      const distance = Math.hypot(...difference);
      if (distance < 0.000001) return;
      maximumError = Math.max(
        maximumError,
        Math.abs(distance - targetLengths[`${first}:${second}`]),
      );
      const error = (distance - targetLengths[`${first}:${second}`]) / distance;
      const firstPinned = first === pinnedJoint;
      const secondPinned = second === pinnedJoint;
      const firstShare = firstPinned ? 0 : secondPinned ? 1 : 0.5;
      const secondShare = secondPinned ? 0 : firstPinned ? 1 : 0.5;
      difference.forEach((value, index) => {
        next[first][index] += value * error * firstShare;
        next[second][index] -= value * error * secondShare;
      });
    });
    if (maximumError < 0.0005) break;
  }
  return Object.fromEntries(
    Object.entries(next).map(([name, position]) => [
      name,
      position.map((value) => Number(value.toFixed(3))),
    ]),
  );
}

function rotateBranch(pose, rootJoint, pivotJoint, radians) {
  const next = Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [name, [...position]]),
  );
  const pivot = next[pivotJoint];
  const rotateJoint = (joint) => {
    const [x, y, z] = next[joint];
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    next[joint] = [
      pivot[0] + dx * Math.cos(radians) - dy * Math.sin(radians),
      pivot[1] + dx * Math.sin(radians) + dy * Math.cos(radians),
      z,
    ];
    (CHILD_JOINTS[joint] || []).forEach(rotateJoint);
  };
  rotateJoint(rootJoint);
  return next;
}

function rotateDescendants(pose, pivotJoint, quaternion) {
  const next = Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [name, [...position]]),
  );
  const pivot = new THREE.Vector3(...next[pivotJoint]);
  const rotateJoint = (joint) => {
    const position = new THREE.Vector3(...next[joint])
      .sub(pivot)
      .applyQuaternion(quaternion)
      .add(pivot);
    next[joint] = position.toArray().map((value) => Number(value.toFixed(3)));
    (CHILD_JOINTS[joint] || []).forEach(rotateJoint);
  };
  (CHILD_JOINTS[pivotJoint] || []).forEach(rotateJoint);
  // A rigid quaternion rotation preserves every pivot-to-child and descendant
  // bone length by construction. Running the global constraint solver here
  // can move the freshly rotated branch back toward its previous pose.
  return next;
}

function poseFromAngleTargets(pose, angleTargets = []) {
  let nextPose = Object.fromEntries(
    Object.entries(pose).map(([name, position]) => [name, [...position]]),
  );
  angleTargets.forEach((target) => {
    const joints = ANGLE_JOINTS[target.body_part];
    const desired = clampAnatomicalAngle(
      target.body_part,
      Number(
        target.target_angle ?? (Number(target.min) + Number(target.max)) / 2,
      ),
    );
    if (!joints || !Number.isFinite(desired)) return;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const current = calculateAngle(
        nextPose[joints.first],
        nextPose[joints.center],
        nextPose[joints.end],
      );
      if (Math.abs(desired - current) < 1) break;
      const positive = rotateBranch(
        nextPose,
        joints.end,
        joints.center,
        (Math.PI / 180) * 3,
      );
      const negative = rotateBranch(
        nextPose,
        joints.end,
        joints.center,
        (-Math.PI / 180) * 3,
      );
      const positiveError = Math.abs(
        desired -
          calculateAngle(
            positive[joints.first],
            positive[joints.center],
            positive[joints.end],
          ),
      );
      const negativeError = Math.abs(
        desired -
          calculateAngle(
            negative[joints.first],
            negative[joints.center],
            negative[joints.end],
          ),
      );
      if (
        positiveError >= Math.abs(desired - current) &&
        negativeError >= Math.abs(desired - current)
      )
        break;
      nextPose = positiveError <= negativeError ? positive : negative;
    }
  });
  return groundPose(restorePlantedFootAndResolve(nextPose, pose));
}

function enforceAnatomicalLimits(pose) {
  const corrections = ANGLES.flatMap(([bodyPart, , first, center, last]) => {
    const angle = calculateAngle(pose[first], pose[center], pose[last]);
    const corrected = clampAnatomicalAngle(bodyPart, angle);
    return corrected === angle
      ? []
      : [{ body_part: bodyPart, target_angle: corrected }];
  });
  return corrections.length ? poseFromAngleTargets(pose, corrections) : pose;
}

function poseFromRanges(rangeTargets = []) {
  return poseFromAngleTargets(freshPose(), rangeTargets);
}

function Bone({ color = "#ffffff", from, to }) {
  return <Line color={color} lineWidth={1.7} points={[from, to]} />;
}

function neckPoint(pose) {
  return [
    (pose.shoulder_left[0] + pose.shoulder_right[0]) / 2,
    (pose.shoulder_left[1] + pose.shoulder_right[1]) / 2 + 0.16,
    (pose.shoulder_left[2] + pose.shoulder_right[2]) / 2,
  ];
}

const ComparisonSkeleton = memo(function ComparisonSkeleton({
  color,
  label,
  offset,
  opacity = 0.72,
  pose,
}) {
  return (
    <group position={offset}>
      {LINKS.filter(([from]) => from !== "head").map(([from, to]) => (
        <Bone
          color={color}
          from={pose[from]}
          key={`${label}-${from}-${to}`}
          to={pose[to]}
        />
      ))}
      <Bone color={color} from={pose.head} to={neckPoint(pose)} />
      {Object.entries(pose).map(([name, position]) => (
        <mesh key={`${label}-${name}`} position={position}>
          <sphereGeometry args={[name === "head" ? 0.19 : 0.08, 20, 20]} />
          <meshStandardMaterial
            color={color}
            emissive="#101820"
            opacity={opacity}
            transparent
          />
        </mesh>
      ))}
      <Html center position={[0, 2.12, 0]}>
        <span className="pose-designer__scene-label">{label}</span>
      </Html>
    </group>
  );
});

const GuideVolume = memo(function GuideVolume() {
  const positions = useMemo(() => {
    const values = [];
    const minimum = -2;
    const maximum = 2;
    const floor = FOOT_CONTACT_Y;
    const ceiling = 2.25;
    const step = 0.5;
    const add = (from, to) => values.push(...from, ...to);
    for (let y = floor; y <= ceiling + 0.001; y += step) {
      for (let z = minimum; z <= maximum + 0.001; z += step)
        add([minimum, y, z], [maximum, y, z]);
      for (let x = minimum; x <= maximum + 0.001; x += step)
        add([x, y, minimum], [x, y, maximum]);
    }
    for (let x = minimum; x <= maximum + 0.001; x += step) {
      for (let z = minimum; z <= maximum + 0.001; z += step)
        add([x, floor, z], [x, ceiling, z]);
    }
    return new Float32Array(values);
  }, []);
  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color="#66839f"
        depthWrite={false}
        opacity={0.14}
        transparent
      />
    </lineSegments>
  );
});

export const ArticulationOverlay = memo(function ArticulationOverlay({
  articulation,
  pose,
}) {
  const face = articulation.face;
  const head = new THREE.Vector3(...pose.head);
  const shoulderLeft = new THREE.Vector3(...pose.shoulder_left);
  const shoulderRight = new THREE.Vector3(...pose.shoulder_right);
  const neck = new THREE.Vector3(...neckPoint(pose));
  const right = shoulderRight.clone().sub(shoulderLeft).normalize();
  const up = head.clone().sub(neck).normalize();
  const forward = right.clone().cross(up).normalize();
  const headPoint = (rightAmount, upAmount, forwardAmount) =>
    head
      .clone()
      .add(right.clone().multiplyScalar(rightAmount))
      .add(up.clone().multiplyScalar(upAmount))
      .add(forward.clone().multiplyScalar(forwardAmount))
      .toArray();
  const faceOutline = [
    headPoint(-0.2, 0.22, 0.045),
    headPoint(0.2, 0.22, 0.045),
    headPoint(0.13, -0.19 - face.jaw_openness * 0.03, 0.075),
    headPoint(0, -0.27 - face.jaw_openness * 0.045, 0.08),
    headPoint(-0.13, -0.19 - face.jaw_openness * 0.03, 0.075),
    headPoint(-0.2, 0.22, 0.045),
  ];
  const gazePoint = headPoint(
    face.gaze_horizontal * 0.045,
    -0.035 + face.gaze_vertical * 0.04,
    0.085,
  );
  const hands = {
    left: buildHandLandmarks(pose, articulation, "left"),
    right: buildHandLandmarks(pose, articulation, "right"),
  };
  return (
    <>
      <Line color="#c8d2dc" lineWidth={1.2} points={faceOutline} />
      <Line
        color="#c8d2dc"
        lineWidth={1.2}
        points={[faceOutline[3], neck.toArray()]}
      />
      <Line
        color="#c8d2dc"
        lineWidth={1.1}
        opacity={0.72}
        points={[shoulderLeft.toArray(), neck.toArray(), shoulderRight.toArray()]}
        transparent
      />
      <Line
        color="#c8d2dc"
        lineWidth={1}
        opacity={0.62}
        points={[faceOutline[0], gazePoint, faceOutline[1]]}
        transparent
      />
      <Line
        color="#c8d2dc"
        lineWidth={1}
        opacity={0.52}
        points={[faceOutline[4], gazePoint, faceOutline[2]]}
        transparent
      />
      {Object.entries(hands).map(([side, landmarks]) => (
        <group key={side}>
          {HAND_CONNECTIONS.map(([from, to]) => (
            <Line
              color="#dbe3e9"
              depthTest={false}
              key={`${from}-${to}`}
              lineWidth={2.6}
              opacity={0.9}
              points={[landmarks[from], landmarks[to]]}
              transparent
            />
          ))}
          {landmarks.slice(1).map((position, index) => (
            <mesh
              key={index + 1}
              position={position}
              renderOrder={26}
              userData={{ landmarkId: `${side}_hand_${index + 1}` }}
            >
              <sphereGeometry
                args={[
                  0.009 - articulation[`hand_${side}`].fist_closure * 0.0045,
                  8,
                  6,
                ]}
              />
              <meshBasicMaterial color="#eef3f6" depthTest={false} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
});

const AxialRigOverlay = memo(function AxialRigOverlay({ pose }) {
  const shoulderCenter = pose.shoulder_left.map(
    (value, index) => (value + pose.shoulder_right[index]) / 2,
  );
  const hipCenter = pose.hip_left.map(
    (value, index) => (value + pose.hip_right[index]) / 2,
  );
  const spine = Array.from({ length: 5 }, (_, index) =>
    hipCenter.map(
      (value, axis) => value + (shoulderCenter[axis] - value) * (index / 4),
    ),
  );
  const sacrum = [hipCenter[0], hipCenter[1] - 0.14, hipCenter[2]];
  const upperPelvis = [hipCenter[0], hipCenter[1] + 0.18, hipCenter[2]];
  const ribs = Array.from({ length: 5 }, (_, index) => {
    const ratio = 0.3 + index * 0.125;
    const center = hipCenter.map(
      (value, axis) => value + (shoulderCenter[axis] - value) * ratio,
    );
    const widthScale = 0.7 + index * 0.06;
    const left = center.map(
      (value, axis) =>
        value + (pose.shoulder_left[axis] - shoulderCenter[axis]) * widthScale,
    );
    const right = center.map(
      (value, axis) =>
        value + (pose.shoulder_right[axis] - shoulderCenter[axis]) * widthScale,
    );
    const sternum = [center[0], center[1] - 0.055, center[2] + 0.035];
    return { center, left, right, sternum };
  });
  return (
    <>
      <Line color="#ffffff" lineWidth={1.6} points={spine} />
      <Line
        color="#ffffff"
        lineWidth={1.25}
        opacity={0.82}
        points={[pose.shoulder_left, neckPoint(pose), pose.shoulder_right]}
        transparent
      />
      {ribs.map((rib, index) => (
        <group key={index}>
          <Line
            color="#ffffff"
            lineWidth={1}
            opacity={0.55}
            points={[rib.center, rib.left, rib.sternum]}
            transparent
          />
          <Line
            color="#ffffff"
            lineWidth={1}
            opacity={0.55}
            points={[rib.center, rib.right, rib.sternum]}
            transparent
          />
        </group>
      ))}
      <Line
        color="#ffffff"
        lineWidth={1.2}
        opacity={0.75}
        points={[pose.hip_left, sacrum, pose.hip_right]}
        transparent
      />
      <Line
        color="#ffffff"
        lineWidth={1.15}
        opacity={0.72}
        points={[pose.hip_left, upperPelvis, pose.hip_right]}
        transparent
      />
      <Line
        color="#ffffff"
        lineWidth={1}
        opacity={0.65}
        points={[pose.hip_left, pose.hip_right, sacrum, pose.hip_left]}
        transparent
      />
      {spine.map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.032, 10, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#222222" />
        </mesh>
      ))}
    </>
  );
});

export const FootDetailOverlay = memo(function FootDetailOverlay({
  animationProgress,
  pose,
  strikingSide,
  strikingSurface,
  targetStrikingSide,
  targetStrikingSurface,
}) {
  const transitionProgress = smoothProgress(animationProgress);
  const appliesToSide = (configuredSide, side) =>
    configuredSide === "both" || configuredSide === side;
  return (
    <>
      {["left", "right"].map((side) => {
        const startsOnBall = Number(
          strikingSurface === "ball_of_foot" && appliesToSide(strikingSide, side),
        );
        const endsOnBall = Number(
          targetStrikingSurface === "ball_of_foot" &&
          appliesToSide(targetStrikingSide, side),
        );
        const ballOfFootProgress = interpolateNumber(
          startsOnBall,
          endsOnBall,
          transitionProgress,
        );
        const activeSurface = ballOfFootProgress > 0.001
          ? "ball_of_foot"
          : appliesToSide(strikingSide, side) ? strikingSurface : "";
        const foot = buildFootLandmarks(pose, side, { ballOfFootProgress });
        const highlighted = new Set(
          activeSurface === "heel" ? ["heel", "innerHeel", "outerHeel"]
            : activeSurface === "ball_of_foot" ? ["ball", "innerBall", "outerBall"]
              : activeSurface === "instep" ? ["mid"]
                : activeSurface === "inner_edge" ? ["innerHeel", "innerMid", "innerBall"]
                  : activeSurface === "outer_edge" ? ["outerHeel", "outerMid", "outerBall"]
                    : activeSurface === "sole" ? ["heel", "mid", "ball"]
                      : [],
        );
        const bones = [
          ["ankle", "heel"], ["heel", "innerHeel"], ["heel", "outerHeel"],
          ["innerHeel", "innerMid"], ["outerHeel", "outerMid"],
          ["innerMid", "innerBall"], ["outerMid", "outerBall"],
          ["innerBall", "ball"], ["ball", "outerBall"], ["ankle", "mid"],
          ["mid", "ball"],
        ];
        const joints = [
          "heel", "innerHeel", "outerHeel", "mid", "innerMid", "outerMid",
          "ball", "innerBall", "outerBall",
        ];
        return (
          <group key={side}>
            {bones.map(([from, to]) => {
              const active = highlighted.has(from) && highlighted.has(to);
              return <Line
                color={active ? "#f2c35f" : "#ffffff"}
                key={`${from}-${to}`}
                lineWidth={active ? 2.2 : 1.25}
                points={[foot[from], foot[to]]}
              />;
            })}
            {joints.map((name) => {
              const active = highlighted.has(name);
              return <mesh key={name} position={foot[name]}>
                <sphereGeometry args={[active ? 0.021 : 0.014, 9, 7]} />
                <meshStandardMaterial
                  color={active ? "#f2c35f" : "#ffffff"}
                  emissive={active ? "#6c4a0b" : "#222222"}
                />
              </mesh>;
            })}
            {foot.toes.map((toe, index) => (
              <group key={index}>
                <Line
                  color={activeSurface === "toes" ? "#f2c35f" : "#ffffff"}
                  lineWidth={activeSurface === "toes" ? 2.1 : 1.1}
                  points={[
                    index < 2 ? foot.innerBall : index > 2 ? foot.outerBall : foot.ball,
                    toe,
                  ]}
                />
                <mesh position={toe}>
                  <sphereGeometry args={[activeSurface === "toes" ? 0.018 : 0.011, 8, 6]} />
                  <meshStandardMaterial
                    color={activeSurface === "toes" ? "#f2c35f" : "#ffffff"}
                    emissive={activeSurface === "toes" ? "#6c4a0b" : "#222222"}
                  />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </>
  );
});

export function PoseScene({
  articulation,
  animationProgress,
  cameraViewRef,
  editingEnabled = true,
  guidesVisible,
  pose,
  poseScale,
  selectedJoint,
  transformMode,
  rotation,
  rotationSnap,
  strikingSide,
  strikingSurface,
  targetStrikingSide,
  targetStrikingSurface,
  onSelectJoint,
  onMoveJoint,
  onRotateJoint,
}) {
  const studio = useContext(PoseStudioContext);
  const { camera } = useThree();
  const orbitControlsRef = useRef(null);
  const studioOffsets = studio?.singlePoseMode
    ? TWO_POSE_OFFSETS
    : STUDIO_OFFSETS;
  const activeOffset = studio
    ? studioOffsets[studio.activeEndpoint]
    : STUDIO_OFFSETS.optimal;
  const sceneScale = studio ? 1 : poseScale;
  // Scale the standalone editor around the planted-foot contact plane instead
  // of the world origin. Otherwise a scale above 1 pushes the feet through the
  // unscaled floor even though the pose coordinates are correctly grounded.
  const groundedActiveOffset = [
    activeOffset[0],
    activeOffset[1] + FOOT_CONTACT_Y * (1 - sceneScale),
    activeOffset[2],
  ];
  const studioPoseA = studio?.poseA;
  const studioPoseB = studio?.poseB;
  const studioOptimalPose = studio?.optimalPose;
  const poseA = useMemo(
    () => poseFromReferencePose(studioPoseA) || (studio ? freshPose() : null),
    [studio, studioPoseA],
  );
  const poseB = useMemo(
    () => poseFromReferencePose(studioPoseB) || (studio ? freshPose() : null),
    [studio, studioPoseB],
  );
  const optimalPose = useMemo(
    () =>
      poseFromReferencePose(studioOptimalPose) || (studio ? freshPose() : null),
    [studio, studioOptimalPose],
  );
  const transformTarget = useMemo(() => new THREE.Object3D(), []);
  const isTransforming = useRef(false);
  const transformFrame = useRef(null);
  const guidePoints = useMemo(() => {
    const shoulderCenter = pose.shoulder_left.map(
      (value, index) => (value + pose.shoulder_right[index]) / 2,
    );
    const hipCenter = pose.hip_left.map(
      (value, index) => (value + pose.hip_right[index]) / 2,
    );
    const bodyCenterX = (shoulderCenter[0] + hipCenter[0]) / 2;
    const guideZ = Math.min(shoulderCenter[2], hipCenter[2]) - 0.08;
    return {
      center: [
        [bodyCenterX, FOOT_CONTACT_Y, guideZ],
        [bodyCenterX, pose.head[1] + 0.3, guideZ],
      ],
      xAxis: [
        [-2.25, FOOT_CONTACT_Y + 0.006, 0],
        [2.25, FOOT_CONTACT_Y + 0.006, 0],
      ],
      yAxis: [
        [0, FOOT_CONTACT_Y, 0],
        [0, pose.head[1] + 0.45, 0],
      ],
      zAxis: [
        [0, FOOT_CONTACT_Y + 0.006, -2.25],
        [0, FOOT_CONTACT_Y + 0.006, 2.25],
      ],
      shoulders: [pose.shoulder_left, pose.shoulder_right],
      hips: [pose.hip_left, pose.hip_right],
      feet: [
        [
          Math.min(pose.foot_left[0], pose.foot_right[0]) - 0.35,
          FOOT_CONTACT_Y,
          guideZ,
        ],
        [
          Math.max(pose.foot_left[0], pose.foot_right[0]) + 0.35,
          FOOT_CONTACT_Y,
          guideZ,
        ],
      ],
    };
  }, [pose]);
  const mediaPipePreview = useMemo(
    () => {
      const preview = manualPoseToMediaPipePreview(pose);
      // Detailed 21-point hand rigs are rendered separately. Suppress Pose's
      // coarse pinky/index/thumb points to avoid duplicate landmarks.
      [17, 18, 19, 20, 21, 22].forEach((id) => {
        preview[id] = null;
      });
      // The editor uses one clean face wireframe instead of rendering the
      // coarse Pose facial dots on top of it.
      for (let id = 0; id <= 10; id += 1) preview[id] = null;
      return preview;
    },
    [pose],
  );
  useEffect(() => {
    if (!studio) return;
    camera.position.set(0, 1.15, 9.4);
  }, [camera, studio]);
  useEffect(() => {
    if (studio) return;
    const savedView = cameraViewRef?.current;
    const position = savedView?.position || [2.8, 1.3, 5.1];
    const target = savedView?.target || [0, 0, 0];
    camera.position.fromArray(position);
    camera.lookAt(...target);
    orbitControlsRef.current?.target.fromArray(target);
    orbitControlsRef.current?.update();
  }, [camera, cameraViewRef, studio]);
  useEffect(() => {
    if (isTransforming.current) return;
    const selectedPosition = pose?.[selectedJoint] || pose?.head || [0, 0, 0];
    transformTarget.position.fromArray(selectedPosition);
    transformTarget.rotation.set(...rotation);
    transformTarget.updateMatrixWorld();
  }, [pose, rotation, selectedJoint, transformTarget]);
  const chooseJoint = (event, name) => {
    event.stopPropagation();
    onSelectJoint(name);
  };
  useEffect(
    () => () => window.cancelAnimationFrame(transformFrame.current),
    [],
  );
  const applyTransform = () => {
    if (transformMode === "translate")
      onMoveJoint(selectedJoint, transformTarget.position.toArray());
    else
      onRotateJoint(
        selectedJoint,
        transformTarget.rotation.toArray().slice(0, 3),
      );
  };
  const handleTransform = () => {
    if (transformFrame.current) return;
    transformFrame.current = window.requestAnimationFrame(() => {
      transformFrame.current = null;
      applyTransform();
    });
  };
  const finishTransform = () => {
    isTransforming.current = false;
    const hasPendingTransform = Boolean(transformFrame.current);
    if (hasPendingTransform)
      window.cancelAnimationFrame(transformFrame.current);
    transformFrame.current = null;
    if (hasPendingTransform) applyTransform();
  };
  return (
    <>
      <hemisphereLight args={["#dcecff", "#17202a", 1.35]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        castShadow
        intensity={2.15}
        position={[3.5, 5.5, 4.5]}
        shadow-bias={-0.0004}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <directionalLight
        color="#86aee0"
        intensity={0.72}
        position={[-4, 2.5, -3]}
      />
      {editingEnabled ? (
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport
            axisColors={["#ef5350", "#60d394", "#6aa8ff"]}
            labelColor="white"
          />
        </GizmoHelper>
      ) : null}
      {studio?.singlePoseMode ? (
        <>
          <mesh
            position={[-1.55, FLOOR_Y - 0.012, 0]}
            receiveShadow
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[2.75, 5.8]} />
            <meshStandardMaterial
              color="#11212a"
              metalness={0.08}
              roughness={0.92}
            />
          </mesh>
          <Grid
            args={[2.7, 5.7]}
            cellColor="#315d67"
            cellSize={0.35}
            fadeDistance={7}
            sectionColor="#58c7ad"
            sectionSize={1.4}
            position={[-1.55, FLOOR_Y, 0]}
          />
          <mesh
            position={[1.55, FLOOR_Y - 0.012, 0]}
            receiveShadow
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[2.75, 5.8]} />
            <meshStandardMaterial
              color="#17202b"
              metalness={0.08}
              roughness={0.92}
            />
          </mesh>
          <Grid
            args={[2.7, 5.7]}
            cellColor="#3e5268"
            cellSize={0.35}
            fadeDistance={7}
            sectionColor="#60d394"
            sectionSize={1.4}
            position={[1.55, FLOOR_Y, 0]}
          />
        </>
      ) : (
        <>
          <mesh
            position={[0, FLOOR_Y - 0.012, 0]}
            receiveShadow
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[12, 8]} />
            <meshStandardMaterial
              color="#111c27"
              metalness={0.08}
              roughness={0.92}
            />
          </mesh>
          <Grid
            args={[9, 9]}
            cellColor="#31506f"
            cellSize={0.5}
            fadeDistance={9}
            infiniteGrid
            sectionColor="#68a8ff"
            sectionSize={2}
            position={[0, FLOOR_Y, 0]}
          />
        </>
      )}
      {guidesVisible ? (
        <group position={groundedActiveOffset} scale={sceneScale}>
          <GuideVolume />
          <Line
            color="#ef5350"
            lineWidth={1.7}
            opacity={0.9}
            points={guidePoints.xAxis}
            transparent
          />
          <Line
            color="#60d394"
            lineWidth={1.7}
            opacity={0.9}
            points={guidePoints.yAxis}
            transparent
          />
          <Line
            color="#6aa8ff"
            lineWidth={1.7}
            opacity={0.9}
            points={guidePoints.zAxis}
            transparent
          />
          <Line
            color="#91a8bf"
            dashed
            dashSize={0.08}
            gapSize={0.05}
            lineWidth={1}
            opacity={0.42}
            points={guidePoints.center}
            transparent
          />
          <Line
            color="#f0bd68"
            dashed
            dashSize={0.08}
            gapSize={0.04}
            lineWidth={1.25}
            opacity={0.68}
            points={guidePoints.shoulders}
            transparent
          />
          <Line
            color="#d69bff"
            dashed
            dashSize={0.08}
            gapSize={0.04}
            lineWidth={1.25}
            opacity={0.62}
            points={guidePoints.hips}
            transparent
          />
          <Line
            color="#60d394"
            dashed
            dashSize={0.1}
            gapSize={0.045}
            lineWidth={1.5}
            opacity={0.8}
            points={guidePoints.feet}
            transparent
          />
        </group>
      ) : null}
      {studio &&
      !studio.singlePoseMode &&
      studio.activeEndpoint !== "pose_a" ? (
        <ComparisonSkeleton
          color="#6aa8ff"
          label="POSE A"
          offset={STUDIO_OFFSETS.pose_a}
          pose={poseA}
        />
      ) : null}
      {studio ? (
        <ComparisonSkeleton
          color={studio.optimalPose ? "#60d394" : "#68717e"}
          label={studio.optimalPose ? "OPTIMIZED" : "OPTIMIZED · PENDING"}
          offset={studioOffsets.optimal}
          opacity={studio.optimalPose ? 0.82 : 0.32}
          pose={optimalPose}
        />
      ) : null}
      {studio &&
      !studio.singlePoseMode &&
      studio.activeEndpoint !== "pose_b" ? (
        <ComparisonSkeleton
          color="#d69bff"
          label="POSE B"
          offset={STUDIO_OFFSETS.pose_b}
          pose={poseB}
        />
      ) : null}
      <group position={groundedActiveOffset} scale={sceneScale}>
        <primitive object={transformTarget} />
        <group>
          <MediaPipeSkeleton3D
            jointRadius={0.025}
            landmarks={mediaPipePreview}
            lineWidth={3.2}
          />
          {Object.entries(pose).map(([name, position]) => (
              <mesh
                key={name}
                onClick={editingEnabled ? (event) => chooseJoint(event, name) : undefined}
                position={position}
                scale={editingEnabled && selectedJoint === name ? 1.16 : 1}
              >
                <sphereGeometry
                  args={[
                    name.startsWith("wrist_")
                      ? AUTHORING_WRIST_RADIUS
                      : AUTHORING_JOINT_RADIUS,
                    14,
                    10,
                  ]}
                />
                <meshStandardMaterial
                  color={editingEnabled && selectedJoint === name ? "#f2c35f" : "#60d394"}
                  emissive={editingEnabled && selectedJoint === name ? "#6c4a0b" : "#112a20"}
                  emissiveIntensity={0.35}
                  roughness={0.62}
                />
              </mesh>
            ))}
            <ArticulationOverlay articulation={articulation} pose={pose} />
            <FootDetailOverlay
              animationProgress={animationProgress}
              pose={pose}
              strikingSide={strikingSide}
              strikingSurface={strikingSurface}
              targetStrikingSide={targetStrikingSide}
              targetStrikingSurface={targetStrikingSurface}
            />
        </group>
        {studio ? (
          <Html center position={[0, 2.12, 0]}>
            <span
              className={`pose-designer__scene-label is-${studio.activeEndpoint}`}
            >
              {studio.singlePoseMode
                ? "INITIAL · EDITING"
                : studio.activeEndpoint === "pose_a"
                  ? "POSE A · EDITING"
                  : "POSE B · EDITING"}
            </span>
          </Html>
        ) : null}
      </group>
      {editingEnabled ? <TransformControls
          enabled={editingEnabled}
          mode={transformMode}
          object={transformTarget}
          onMouseDown={() => {
            isTransforming.current = true;
          }}
          onMouseUp={finishTransform}
          onObjectChange={handleTransform}
          rotationSnap={rotationSnap ? THREE.MathUtils.degToRad(5) : null}
          size={0.68}
          space="world"
      /> : null}
      <OrbitControls
        makeDefault
        maxDistance={12}
        minDistance={3}
        onChange={(event) => {
          if (!cameraViewRef || studio) return;
          cameraViewRef.current = {
            position: camera.position.toArray(),
            target: event.target.target.toArray(),
          };
        }}
        ref={orbitControlsRef}
      />
    </>
  );
}

export default function PoseRangeDesigner({
  cameraViewRef = null,
  emitInitialPoseChange = true,
  initialAngleTolerance = 12,
  onApply,
  onPoseChange,
  onTimelineStepSelect,
  onTransitionDurationChange,
  rangeTargets = [],
  referencePose = null,
  strikingSide = "",
  strikingSurface = "",
  studioActions = null,
  studioLead = null,
  timelineCycle = null,
  timelineStepIndex = 0,
  timelineSteps = [],
  transitionDurationMs = 1600,
  transitionTarget = null,
}) {
  const workbenchRef = useRef(null);
  const studio = useContext(PoseStudioContext);
  const [pose, setPose] = useState(() =>
    enforceAnatomicalLimits(
      groundPose(
        poseFromReferencePose(referencePose) ||
          (rangeTargets.length ? poseFromRanges(rangeTargets) : freshPose()),
      ),
    ),
  );
  const [selectedJoint, setSelectedJoint] = useState("elbow_left");
  const [tolerance, setTolerance] = useState(initialAngleTolerance);
  const [positionTolerance, setPositionTolerance] = useState(
    () => Number(referencePose?.tolerance) || 0.03,
  );
  const [transformMode, setTransformMode] = useState("translate");
  const [rotationSnap, setRotationSnap] = useState(false);
  const [jointRotations, setJointRotations] = useState(() =>
    wristRotationsFromArticulation(referencePose?.articulation),
  );
  const jointRotationsRef = useRef(jointRotations);
  const [draftAngleValues, setDraftAngleValues] = useState(() =>
    Object.fromEntries(
      ANGLES.map(([body_part, , first, center, last]) => [
        body_part,
        String(calculateAngle(pose[first], pose[center], pose[last])),
      ]),
    ),
  );
  const [activeAngleInput, setActiveAngleInput] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [anglesOpen, setAnglesOpen] = useState(true);
  const [guidesVisible, setGuidesVisible] = useState(false);
  const [articulation, setArticulation] = useState(() =>
    normalizedArticulation(referencePose?.articulation),
  );
  const [animationProgress, setAnimationProgress] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationFrameRef = useRef(null);
  const animationProgressRef = useRef(0);
  const animationStartedAtRef = useRef(0);
  const [sequenceTimeMs, setSequenceTimeMs] = useState(0);
  const [isSequencePlaying, setIsSequencePlaying] = useState(false);
  const [sequencePreviewActive, setSequencePreviewActive] = useState(false);
  const sequenceFrameRef = useRef(null);
  const sequenceTimeRef = useRef(0);
  const sequenceStartedAtRef = useRef(0);
  const animationDuration = Math.max(
    200,
    Math.min(10000, Number(transitionDurationMs) || 1600),
  );
  const transitionPose = useMemo(
    () => poseFromReferencePose(transitionTarget?.reference_pose),
    [transitionTarget],
  );
  const animationLinkLengths = useMemo(
    () => linkLengthsFromPose(
      poseFromReferencePose(timelineSteps[0]?.reference_pose) || pose,
    ),
    [pose, timelineSteps],
  );
  const techniqueTimeline = useMemo(
    () => buildTechniqueTimeline(timelineSteps, timelineCycle),
    [timelineCycle, timelineSteps],
  );
  const sequenceFrame = useMemo(
    () => timelineFrameAt(techniqueTimeline, sequenceTimeMs),
    [sequenceTimeMs, techniqueTimeline],
  );
  const sequenceReady = Boolean(
    techniqueTimeline.totalDurationMs &&
    timelineSteps.every((step) => step.reference_pose?.landmarks),
  );
  const timelineDisplayIndex = sequencePreviewActive && sequenceFrame
    ? sequenceFrame.fromIndex
    : timelineStepIndex;
  const sequenceFromStep = sequenceFrame
    ? timelineSteps[sequenceFrame.fromIndex]
    : null;
  const sequenceToStep = sequenceFrame
    ? timelineSteps[sequenceFrame.toIndex]
    : null;
  const sequenceFromPose = useMemo(
    () => poseFromReferencePose(sequenceFromStep?.reference_pose),
    [sequenceFromStep],
  );
  const sequenceToPose = useMemo(
    () => poseFromReferencePose(sequenceToStep?.reference_pose),
    [sequenceToStep],
  );
  const sequencePose = useMemo(
    () => sequencePreviewActive && sequenceFrame && sequenceFromPose && sequenceToPose
      ? interpolatePose(
          sequenceFromPose,
          sequenceToPose,
          sequenceFrame.progress,
          animationLinkLengths,
        )
      : null,
    [
      animationLinkLengths,
      sequenceFrame,
      sequenceFromPose,
      sequencePreviewActive,
      sequenceToPose,
    ],
  );
  const previewPose = useMemo(
    () =>
      sequencePose || (transitionPose && (isAnimating || animationProgress > 0)
        ? interpolatePose(
            pose,
            transitionPose,
            animationProgress,
            animationLinkLengths,
          )
        : pose),
    [
      animationLinkLengths,
      animationProgress,
      isAnimating,
      pose,
      sequencePose,
      transitionPose,
    ],
  );
  const previewArticulation = useMemo(
    () =>
      sequencePreviewActive && sequenceFrame && sequenceFromStep && sequenceToStep
        ? interpolateArticulation(
            sequenceFromStep.reference_pose?.articulation,
            sequenceToStep.reference_pose?.articulation,
            sequenceFrame.progress,
          )
        : transitionPose && animationProgress > 0
        ? interpolateArticulation(
            articulation,
            transitionTarget?.reference_pose?.articulation,
            animationProgress,
          )
        : articulation,
    [
      animationProgress,
      articulation,
      sequenceFrame,
      sequenceFromStep,
      sequencePreviewActive,
      sequenceToStep,
      transitionPose,
      transitionTarget,
    ],
  );
  const boundaryStatus = useMemo(
    () =>
      transitionPose
        ? transitionBoundaryStatus(
            previewPose,
            rangeTargets,
            transitionTarget?.angle_targets || [],
            animationProgress,
          )
        : null,
    [
      animationProgress,
      previewPose,
      rangeTargets,
      transitionPose,
      transitionTarget,
    ],
  );
  const initialPoseStateSignature = useRef(
    JSON.stringify({ articulation, pose, positionTolerance, tolerance }),
  );
  const loadedTimelineStepIndexRef = useRef(timelineStepIndex);
  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === workbenchRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  const stopAnimation = useCallback(() => {
    setIsAnimating(false);
    if (animationFrameRef.current)
      window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);
  const stopSequence = useCallback(() => {
    setIsSequencePlaying(false);
    if (sequenceFrameRef.current)
      window.cancelAnimationFrame(sequenceFrameRef.current);
    sequenceFrameRef.current = null;
  }, []);
  useEffect(() => {
    if (!isAnimating || !transitionPose) return undefined;
    animationStartedAtRef.current =
      performance.now() - animationProgressRef.current * animationDuration;
    const animate = (timestamp) => {
      const nextProgress = Math.min(
        1,
        (timestamp - animationStartedAtRef.current) / animationDuration,
      );
      animationProgressRef.current = nextProgress;
      setAnimationProgress(nextProgress);
      if (nextProgress >= 1) {
        setIsAnimating(false);
        animationFrameRef.current = null;
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current)
        window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [animationDuration, isAnimating, transitionPose]);
  useEffect(() => {
    if (!isSequencePlaying || !techniqueTimeline.totalDurationMs)
      return undefined;
    sequenceStartedAtRef.current =
      performance.now() - sequenceTimeRef.current;
    const animateSequence = (timestamp) => {
      const nextTime = Math.min(
        techniqueTimeline.totalDurationMs,
        timestamp - sequenceStartedAtRef.current,
      );
      sequenceTimeRef.current = nextTime;
      setSequenceTimeMs(nextTime);
      if (nextTime >= techniqueTimeline.totalDurationMs) {
        setIsSequencePlaying(false);
        sequenceFrameRef.current = null;
        return;
      }
      sequenceFrameRef.current = window.requestAnimationFrame(animateSequence);
    };
    sequenceFrameRef.current = window.requestAnimationFrame(animateSequence);
    return () => {
      if (sequenceFrameRef.current)
        window.cancelAnimationFrame(sequenceFrameRef.current);
      sequenceFrameRef.current = null;
    };
  }, [isSequencePlaying, techniqueTimeline.totalDurationMs]);
  useEffect(() => {
    const handleShortcut = (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
      )
        return;
      if (event.key.toLowerCase() === "g") setTransformMode("translate");
      if (event.key.toLowerCase() === "r") setTransformMode("rotate");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  const calculated = useMemo(
    () =>
      ANGLES.map(([body_part, label, first, center, last]) => ({
        body_part,
        label,
        target_angle: calculateAngle(pose[first], pose[center], pose[last]),
      })),
    [pose],
  );
  const syncAngleDrafts = (nextPose, activeBodyPart = null) => {
    setDraftAngleValues((current) =>
      Object.fromEntries(
        ANGLES.map(([body_part, , first, center, last]) => {
          const nextValue = String(
            calculateAngle(nextPose[first], nextPose[center], nextPose[last]),
          );
          if (activeBodyPart && body_part === activeBodyPart)
            return [body_part, current[body_part] ?? nextValue];
          return [body_part, nextValue];
        }),
      ),
    );
  };
  const moveJoint = (name, position) =>
    setPose((current) => {
      const currentPosition = current[name];
      let nextPosition = position;
      const parent = PARENT_JOINTS[name];
      if (parent) {
        const parentPosition = current[parent];
        const direction = position.map(
          (value, index) => value - parentPosition[index],
        );
        const directionLength = Math.hypot(...direction);
        if (directionLength > 0.0001)
          nextPosition = direction.map(
            (value, index) =>
              parentPosition[index] +
              (value / directionLength) * BONE_LENGTHS[name],
          );
        else nextPosition = [...currentPosition];
      }
      const change = nextPosition.map(
        (value, index) => value - currentPosition[index],
      );
      const nextPose = {
        ...current,
        [name]: nextPosition.map((value) => Number(value.toFixed(3))),
      };
      const moveChildren = (parentName) =>
        (CHILD_JOINTS[parentName] || []).forEach((child) => {
          nextPose[child] = nextPose[child].map((value, index) =>
            Number((value + change[index]).toFixed(3)),
          );
          moveChildren(child);
        });
      moveChildren(name);
      const nextResolvedPose = enforceAnatomicalLimits(
        groundPose(restorePlantedFootAndResolve(nextPose, current, name)),
      );
      syncAngleDrafts(nextResolvedPose, activeAngleInput);
      return nextResolvedPose;
    });
  const updateJointCoordinate = (name, index, value) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    const position = [...pose[name]];
    position[index] = Math.max(-3, Math.min(3, nextValue));
    setSelectedJoint(name);
    moveJoint(name, position);
  };
  const updateCoordinate = (index, value) =>
    updateJointCoordinate(selectedJoint, index, value);
  const updateArticulation = (group, field, value) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    setArticulation((current) => ({
      ...current,
      [group]: { ...current[group], [field]: nextValue },
    }));
  };
  const resetHand = (group) => {
    const wristName = group === "hand_left" ? "wrist_left" : "wrist_right";
    const neutralRotation = [0, 0, 0];
    setArticulation((current) => ({
      ...current,
      [group]: freshHandArticulation(),
    }));
    jointRotationsRef.current = {
      ...jointRotationsRef.current,
      [wristName]: neutralRotation,
    };
    setJointRotations(jointRotationsRef.current);
  };
  const resetHands = () => {
    setArticulation((current) => ({
      ...current,
      hand_left: freshHandArticulation(),
      hand_right: freshHandArticulation(),
    }));
    const neutralRotations = {
      ...jointRotationsRef.current,
      wrist_left: [0, 0, 0],
      wrist_right: [0, 0, 0],
    };
    jointRotationsRef.current = neutralRotations;
    setJointRotations(neutralRotations);
  };
  const rotateJoint = (name, nextRotation) => {
    const normalizedRotation = nextRotation.map((value) =>
      Number.isFinite(value) ? value : 0,
    );
    const previousRotation = jointRotationsRef.current[name] || [0, 0, 0];
    if (name === "wrist_left" || name === "wrist_right") {
      const group = name === "wrist_left" ? "hand_left" : "hand_right";
      setArticulation((current) => ({
        ...current,
        [group]: {
          ...current[group],
          wrist_rotation: normalizedRotation,
        },
      }));
      jointRotationsRef.current = {
        ...jointRotationsRef.current,
        [name]: normalizedRotation,
      };
      setJointRotations(jointRotationsRef.current);
      return;
    }
    const previousQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...previousRotation),
    );
    const nextQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...normalizedRotation),
    );
    const deltaQuaternion = nextQuaternion
      .clone()
      .multiply(previousQuaternion.clone().invert());
    setPose((current) => {
      const nextPose = enforceAnatomicalLimits(
        groundPose(rotateDescendants(current, name, deltaQuaternion)),
      );
      syncAngleDrafts(nextPose, activeAngleInput);
      return nextPose;
    });
    jointRotationsRef.current = {
      ...jointRotationsRef.current,
      [name]: normalizedRotation,
    };
    setJointRotations(jointRotationsRef.current);
  };
  const updateRotation = (index, value) => {
    const degrees = Number(value);
    if (!Number.isFinite(degrees)) return;
    const rotation = [...(jointRotations[selectedJoint] || [0, 0, 0])];
    rotation[index] = THREE.MathUtils.degToRad(degrees);
    rotateJoint(selectedJoint, rotation);
  };
  const updateAngleDraft = (bodyPart, value) => {
    setDraftAngleValues((current) => ({ ...current, [bodyPart]: value }));
  };
  const applyAngleTarget = (bodyPart, rawValue) => {
    if (rawValue === "" || rawValue === null || rawValue === undefined) return;
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue)) return;
    const clampedValue = clampAnatomicalAngle(bodyPart, nextValue);
    setPose((current) => {
      const nextPose = poseFromAngleTargets(current, [
        { body_part: bodyPart, target_angle: clampedValue },
      ]);
      syncAngleDrafts(nextPose, activeAngleInput);
      return nextPose;
    });
    jointRotationsRef.current = {};
    setJointRotations({});
    setDraftAngleValues((current) => ({
      ...current,
      [bodyPart]: String(clampedValue),
    }));
  };
  const commitAngleTarget = (bodyPart) => {
    applyAngleTarget(bodyPart, draftAngleValues[bodyPart]);
    setActiveAngleInput(null);
  };
  const apply = () => {
    const safeAngleTolerance = Math.min(30, Math.max(1, tolerance));
    const safePositionTolerance = Math.max(0.01, positionTolerance);
    setTolerance(safeAngleTolerance);
    setPositionTolerance(safePositionTolerance);
    onApply(
      calculated.map((item) => ({
        ...item,
        min: Math.max(
          anatomicalLimits(item.body_part).min,
          item.target_angle - safeAngleTolerance,
        ),
        max: Math.min(
          anatomicalLimits(item.body_part).max,
          item.target_angle + safeAngleTolerance,
        ),
        role: "supporting",
        weight: 1,
      })),
      referencePoseFromPose(
        pose,
        Math.min(0.5, safePositionTolerance),
        articulation,
      ),
      {
        angle_degrees: safeAngleTolerance,
        position_normalized: safePositionTolerance,
      },
    );
  };
  useEffect(() => {
    if (loadedTimelineStepIndexRef.current === timelineStepIndex)
      return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      loadedTimelineStepIndexRef.current = timelineStepIndex;
      stopAnimation();
      stopSequence();
      animationProgressRef.current = 0;
      setAnimationProgress(0);
      const selectedStartMs = techniqueTimeline.segments.find(
        (segment) => segment.fromIndex === timelineStepIndex,
      )?.startMs ?? techniqueTimeline.totalDurationMs;
      sequenceTimeRef.current = selectedStartMs;
      setSequenceTimeMs(selectedStartMs);
      setSequencePreviewActive(false);

      const nextPose = enforceAnatomicalLimits(
        groundPose(
          poseFromReferencePose(referencePose) ||
            (rangeTargets.length
              ? poseFromRanges(rangeTargets)
              : freshPose()),
        ),
      );
      const nextArticulation = normalizedArticulation(
        referencePose?.articulation,
      );
      const nextPositionTolerance =
        Number(referencePose?.tolerance) || 0.03;
      const nextAngleTolerance = initialAngleTolerance;
      const nextWristRotations = wristRotationsFromArticulation(
        referencePose?.articulation,
      );

      setPose(nextPose);
      setArticulation(nextArticulation);
      setPositionTolerance(nextPositionTolerance);
      setTolerance(nextAngleTolerance);
      setActiveAngleInput(null);
      setDraftAngleValues(
        Object.fromEntries(
          ANGLES.map(([body_part, , first, center, last]) => [
            body_part,
            String(
              calculateAngle(nextPose[first], nextPose[center], nextPose[last]),
            ),
          ]),
        ),
      );
      jointRotationsRef.current = nextWristRotations;
      setJointRotations(nextWristRotations);
      initialPoseStateSignature.current = JSON.stringify({
        articulation: nextArticulation,
        pose: nextPose,
        positionTolerance: nextPositionTolerance,
        tolerance: nextAngleTolerance,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    initialAngleTolerance,
    rangeTargets,
    referencePose,
    stopAnimation,
    stopSequence,
    techniqueTimeline,
    timelineStepIndex,
  ]);
  useEffect(() => {
    const currentSignature = JSON.stringify({
      articulation,
      pose,
      positionTolerance,
      tolerance,
    });
    if (
      !emitInitialPoseChange &&
      currentSignature === initialPoseStateSignature.current
    )
      return;
    onPoseChange?.(
      referencePoseFromPose(pose, positionTolerance, articulation),
      calculated.map((item) => ({
        ...item,
        min: Math.max(
          anatomicalLimits(item.body_part).min,
          item.target_angle - tolerance,
        ),
        max: Math.min(
          anatomicalLimits(item.body_part).max,
          item.target_angle + tolerance,
        ),
        role: "supporting",
        weight: 1,
      })),
    );
  }, [
    articulation,
    calculated,
    emitInitialPoseChange,
    onPoseChange,
    pose,
    positionTolerance,
    tolerance,
  ]);
  const loadCurrentRanges = () => {
    const nextPose = enforceAnatomicalLimits(
      groundPose(
        poseFromReferencePose(referencePose) || poseFromRanges(rangeTargets),
      ),
    );
    setPose(nextPose);
    syncAngleDrafts(nextPose);
    setArticulation(normalizedArticulation(referencePose?.articulation));
    setPositionTolerance(Number(referencePose?.tolerance) || 0.12);
    const savedWristRotations = wristRotationsFromArticulation(
      referencePose?.articulation,
    );
    jointRotationsRef.current = savedWristRotations;
    setJointRotations(savedWristRotations);
  };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workbenchRef.current?.requestFullscreen();
  };
  const selectedRotation = jointRotations[selectedJoint] || [0, 0, 0];
  const resetPose = () => {
    const nextPose = groundPose(freshPose());
    setPose(nextPose);
    syncAngleDrafts(nextPose);
    setSelectedJoint("elbow_left");
    setArticulation(normalizedArticulation());
    jointRotationsRef.current = {};
    setJointRotations({});
  };
  const renderPoseCanvas = () => (
    <Canvas
      camera={{ fov: 32, position: [2.8, 1.3, 5.1] }}
      shadows
    >
      <color attach="background" args={["#0c121b"]} />
      <PoseScene
        articulation={previewArticulation}
        animationProgress={sequencePreviewActive
          ? sequenceFrame?.progress || 0
          : animationProgress}
        cameraViewRef={cameraViewRef}
        editingEnabled={
          !sequencePreviewActive && !isAnimating && animationProgress === 0
        }
        guidesVisible={guidesVisible}
        onMoveJoint={moveJoint}
        onRotateJoint={rotateJoint}
        onSelectJoint={setSelectedJoint}
        pose={previewPose}
        poseScale={1.35}
        rotation={selectedRotation}
        rotationSnap={rotationSnap}
        selectedJoint={selectedJoint}
        strikingSide={sequencePreviewActive
          ? sequenceFromStep?.striking_side || ""
          : strikingSide}
        strikingSurface={sequencePreviewActive
          ? sequenceFromStep?.striking_surface || ""
          : strikingSurface}
        targetStrikingSide={sequencePreviewActive
          ? sequenceToStep?.striking_side || ""
          : transitionTarget?.striking_side || ""}
        targetStrikingSurface={sequencePreviewActive
          ? sequenceToStep?.striking_surface || ""
          : transitionTarget?.striking_surface || ""}
        transformMode={transformMode}
      />
    </Canvas>
  );
  return (
    <section
      className="pose-designer pose-designer--workbench"
      ref={workbenchRef}
    >
      <div
        className={`pose-designer__toolbar ${studio ? "is-studio-toolbar" : ""}`}
      >
        <div>
          {studioLead || (
            <span className="catalog-admin__eyebrow">Pose workbench</span>
          )}
          <div
            className="pose-designer__mode-switch"
            aria-label="Transform mode"
          >
            <button
              className={transformMode === "translate" ? "is-active" : ""}
              onClick={() => setTransformMode("translate")}
              title="Move joints (G)"
              type="button"
            >
              Move <kbd>G</kbd>
            </button>
            <button
              className={transformMode === "rotate" ? "is-active" : ""}
              onClick={() => setTransformMode("rotate")}
              title="Rotate limbs (R)"
              type="button"
            >
              Rotate <kbd>R</kbd>
            </button>
          </div>
        </div>
        <span className="pose-designer__navigation-help">
          Orbit: drag · Pan: right drag · Zoom: wheel
        </span>
        <div className="pose-designer__toolbar-actions">
          {studioActions}
          <button
            aria-pressed={guidesVisible}
            className={`btn btn--ghost btn--small ${guidesVisible ? "is-active" : ""}`}
            onClick={() => setGuidesVisible((value) => !value)}
            title="Toggle alignment grid and body guide lines"
            type="button"
          >
            Guides
          </button>
          <details className="pose-designer__panels-menu">
            <summary className="btn btn--ghost btn--small">Panels</summary>
            <div>
              <button
                aria-pressed={inspectorOpen}
                className={inspectorOpen ? "is-active" : ""}
                onClick={() => setInspectorOpen((value) => !value)}
                type="button"
              >
                Inspector
              </button>
              <button
                aria-pressed={anglesOpen}
                className={anglesOpen ? "is-active" : ""}
                onClick={() => setAnglesOpen((value) => !value)}
                type="button"
              >
                Angles
              </button>
            </div>
          </details>
          <button
            className="btn btn--ghost btn--small"
            onClick={loadCurrentRanges}
            title="Load saved step pose"
            type="button"
          >
            Load
          </button>
          {!studio ? (
            <button
              className="btn btn--ghost btn--small"
              onClick={toggleFullscreen}
              type="button"
            >
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
          ) : null}
          <button
            className="btn btn--ghost btn--small"
            onClick={resetPose}
            title="Reset current endpoint"
            type="button"
          >
            Reset
          </button>
        </div>
      </div>
      {timelineSteps.length > 1 ? (
        <section className="pose-designer__timeline" aria-label="Technique animation timeline">
          <header>
            <div>
              <strong>Technique timeline</strong>
              <span>Step points and normalized transition ranges</span>
            </div>
            <div className="pose-designer__timeline-controls">
              {transitionTarget ? (
                <>
                <button
                  className="btn btn--light btn--small"
                  disabled={!transitionPose}
                  onClick={() => {
                    if (isAnimating) stopAnimation();
                    else {
                      if (animationProgress >= 1) {
                        animationProgressRef.current = 0;
                        setAnimationProgress(0);
                      } else animationProgressRef.current = animationProgress;
                      setIsAnimating(true);
                    }
                  }}
                  type="button"
                >
                  {isAnimating
                    ? "Pause"
                    : animationProgress > 0 && animationProgress < 1
                      ? "Resume"
                      : animationProgress >= 1
                        ? "Replay"
                        : "Play transition"}
                </button>
                <label className="pose-designer__timeline-duration">
                  <span>Duration</span>
                  <input
                    aria-label="Transition duration in milliseconds"
                    max="10000"
                    min="200"
                    onChange={(event) =>
                      onTransitionDurationChange?.(event.target.value)
                    }
                    step="100"
                    type="number"
                    value={animationDuration}
                  />
                  <span>ms</span>
                </label>
                <span
                  className={`pose-designer__animation-boundary ${boundaryStatus?.violations.length ? "has-violations" : "is-valid"}`}
                  title={boundaryStatus?.violations
                    .map((item) => `${item.label}: ${item.angle}° outside ${Math.round(item.minimum)}–${Math.round(item.maximum)}°`)
                    .join("\n")}
                >
                  {!transitionPose
                    ? "Next pose missing"
                    : boundaryStatus?.checked
                      ? boundaryStatus.violations.length
                        ? `${boundaryStatus.violations.length} outside bounds`
                        : "Within bounds"
                      : "Normalized preview"}
                </span>
                </>
              ) : (
                <span className="pose-designer__timeline-end">Final step</span>
              )}
              <button
                className="btn btn--light btn--small"
                disabled={!sequenceReady}
                onClick={() => {
                  if (isSequencePlaying) {
                    stopSequence();
                    return;
                  }
                  stopAnimation();
                  animationProgressRef.current = 0;
                  setAnimationProgress(0);
                  setSequencePreviewActive(true);
                  if (sequenceTimeMs >= techniqueTimeline.totalDurationMs) {
                    sequenceTimeRef.current = 0;
                    setSequenceTimeMs(0);
                  } else sequenceTimeRef.current = sequenceTimeMs;
                  setIsSequencePlaying(true);
                }}
                type="button"
              >
                {isSequencePlaying
                  ? "Pause all"
                  : sequencePreviewActive && sequenceTimeMs > 0 &&
                      sequenceTimeMs < techniqueTimeline.totalDurationMs
                    ? "Resume all"
                    : sequenceTimeMs >= techniqueTimeline.totalDurationMs
                      ? "Replay all"
                      : "Play all"}
              </button>
            </div>
          </header>
          <div className="pose-designer__timeline-track">
            {timelineSteps.flatMap((timelineStep, index) => {
              const elements = [
                <button
                  aria-current={index === timelineDisplayIndex ? "step" : undefined}
                  className={`pose-designer__timeline-point ${index === timelineDisplayIndex ? "is-current" : ""} ${timelineStep.reference_pose ? "has-pose" : "is-missing"}`}
                  key={`point-${timelineStep.step_number}-${index}`}
                  onClick={() => {
                    stopSequence();
                    setSequencePreviewActive(false);
                    onTimelineStepSelect?.(index);
                  }}
                  title={`${timelineStep.step_name}${timelineStep.reference_pose ? "" : " — pose missing"}`}
                  type="button"
                >
                  <i>{index + 1}</i>
                  <span>{timelineStep.step_name}</span>
                </button>,
              ];
              if (index < timelineSteps.length - 1) {
                const duration = Math.max(
                  200,
                  Math.min(10000, Number(timelineStep.transition_duration_ms) || 1600),
                );
                elements.push(
                  <button
                    className={`pose-designer__timeline-range ${index === timelineDisplayIndex ? "is-current" : ""}`}
                    key={`range-${timelineStep.step_number}-${index}`}
                    onClick={() => {
                      stopSequence();
                      setSequencePreviewActive(false);
                      onTimelineStepSelect?.(index);
                    }}
                    style={{ flexGrow: duration }}
                    title={`Transition ${index + 1} to ${index + 2}: ${duration} ms`}
                    type="button"
                  >
                    <span>{duration / 1000}s transition</span>
                    {index === timelineDisplayIndex &&
                    (sequencePreviewActive || transitionPose) ? (
                      <i style={{
                        left: `${(sequencePreviewActive
                          ? sequenceFrame?.progress || 0
                          : animationProgress) * 100}%`,
                      }} />
                    ) : null}
                  </button>,
                );
              }
              return elements;
            })}
          </div>
          {techniqueTimeline.totalDurationMs ? (
            <div className="pose-designer__timeline-scrubber pose-designer__timeline-scrubber--combined">
              <span>
                {sequencePreviewActive && sequenceFromStep
                  ? sequenceFromStep.step_name
                  : timelineSteps[0]?.step_name}
              </span>
              <input
                aria-label="Combined technique timeline"
                disabled={!sequenceReady}
                max={techniqueTimeline.totalDurationMs}
                min="0"
                onChange={(event) => {
                  stopAnimation();
                  stopSequence();
                  const nextTime = Number(event.target.value);
                  sequenceTimeRef.current = nextTime;
                  setSequenceTimeMs(nextTime);
                  setSequencePreviewActive(true);
                }}
                step="10"
                type="range"
                value={Math.min(
                  sequenceTimeMs,
                  techniqueTimeline.totalDurationMs,
                )}
              />
              <output>
                {(sequenceTimeMs / 1000).toFixed(2)}s / {" "}
                {(techniqueTimeline.totalDurationMs / 1000).toFixed(2)}s
              </output>
              <span>
                {sequencePreviewActive && sequenceToStep
                  ? sequenceToStep.step_name
                  : timelineSteps[timelineSteps.length - 1]?.step_name}
              </span>
              {sequencePreviewActive ? (
                <button
                  className="pose-designer__animation-reset"
                  onClick={() => {
                    stopSequence();
                    setSequencePreviewActive(false);
                    const selectedStartMs =
                      techniqueTimeline.segments.find(
                        (segment) => segment.fromIndex === timelineStepIndex,
                      )?.startMs ?? techniqueTimeline.totalDurationMs;
                    sequenceTimeRef.current = selectedStartMs;
                    setSequenceTimeMs(selectedStartMs);
                  }}
                  type="button"
                >
                  Return to edit
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <div
        className={`pose-designer__workbench ${inspectorOpen ? "" : "is-inspector-collapsed"}`}
      >
        <div className="pose-designer__viewport">
          <div className="pose-designer__viewport-bar">
            <span>Perspective</span>
            <span>Pose collection / {selectedJoint}</span>
          </div>
          {renderPoseCanvas()}
          <div className="pose-designer__canvas-status">
            <span>
              Selected: <strong>{jointLabel(selectedJoint)}</strong>
            </span>
            <span>
              {transformMode === "rotate"
                ? "Drag a colored ring to rotate the limb"
                : "Drag an axis to position the joint"}
            </span>
            <span>
              {Object.keys(pose).length} points · {LINKS.length} fixed bones
            </span>
          </div>
        </div>
        {inspectorOpen ? (
          <aside className="pose-designer__inspector">
            <section>
              <header>
                Outliner <span>Pose</span>
              </header>
              <div className="pose-designer__joint-list">
                {Object.keys(pose).map((joint) => (
                  <button
                    className={selectedJoint === joint ? "is-selected" : ""}
                    key={joint}
                    onClick={() => setSelectedJoint(joint)}
                    type="button"
                  >
                    <i />
                    {jointLabel(joint)}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <header>
                Transform{" "}
                <span>
                  {transformMode === "translate" ? "Location" : "Rotation"}
                </span>
              </header>
              {transformMode === "translate" ? (
                <>
                  <div className="pose-designer__rig-lock pose-designer__rig-lock--fixed">
                    <span aria-hidden="true">●</span> All bone lengths fixed
                  </div>
                  {["X", "Y", "Z"].map((axis, index) => (
                    <label
                      className={`pose-designer__axis pose-designer__axis--${axis.toLowerCase()}`}
                      key={axis}
                    >
                      {axis}
                      <input
                        onChange={(event) =>
                          updateCoordinate(index, event.target.value)
                        }
                        step=".01"
                        type="number"
                        value={pose[selectedJoint][index]}
                      />
                    </label>
                  ))}
                </>
              ) : (
                <>
                  <label className="pose-designer__rig-lock">
                    <input
                      checked={rotationSnap}
                      onChange={(event) =>
                        setRotationSnap(event.target.checked)
                      }
                      type="checkbox"
                    />{" "}
                    Snap to 5°
                  </label>
                  {["X", "Y", "Z"].map((axis, index) => (
                    <label
                      className={`pose-designer__axis pose-designer__axis--${axis.toLowerCase()}`}
                      key={axis}
                    >
                      {axis}
                      <span className="pose-designer__degree-input">
                        <input
                          onChange={(event) =>
                            updateRotation(index, event.target.value)
                          }
                          step="1"
                          type="number"
                          value={Number(
                            THREE.MathUtils.radToDeg(
                              selectedRotation[index],
                            ).toFixed(1),
                          )}
                        />
                        <span>°</span>
                      </span>
                    </label>
                  ))}
                  {!(CHILD_JOINTS[selectedJoint] || []).length &&
                  !selectedJoint.startsWith("wrist_") ? (
                    <p className="pose-designer__rotation-hint">
                      This end joint has no downstream limb to rotate.
                    </p>
                  ) : null}
                </>
              )}
            </section>
            <section className="pose-designer__face-hands">
              <header>
                Face &amp; hands <span>Editable</span>
              </header>
              <div className="pose-designer__landmark-cards">
                {["head", "wrist_left", "wrist_right"].map((name) => (
                  <article
                    className={selectedJoint === name ? "is-selected" : ""}
                    key={name}
                  >
                    <button
                      onClick={() => setSelectedJoint(name)}
                      type="button"
                    >
                      <span aria-hidden="true">
                        {name === "head" ? "◯" : "╱╲"}
                      </span>
                      <strong>{jointLabel(name)}</strong>
                      <small>Position tracked</small>
                    </button>
                    <div>
                      {["X", "Y", "Z"].map((axis, index) => (
                        <label
                          className={`is-${axis.toLowerCase()}`}
                          key={axis}
                        >
                          {axis}
                          <input
                            aria-label={`${jointLabel(name)} ${axis}`}
                            onChange={(event) =>
                              updateJointCoordinate(
                                name,
                                index,
                                event.target.value,
                              )
                            }
                            step=".01"
                            type="number"
                            value={pose[name][index]}
                          />
                        </label>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <div className="pose-designer__articulation-controls">
                <div className="pose-designer__control-heading">
                  <h4>Face controls</h4>
                  <button
                    className="btn btn--light btn--small"
                    onClick={resetHands}
                    type="button"
                  >
                    Reset both hands
                  </button>
                </div>
                {[
                  ["gaze_horizontal", "Gaze left / right", -1, 1],
                  ["gaze_vertical", "Gaze down / up", -1, 1],
                  ["eye_openness", "Eyes open", 0, 1],
                  ["tension", "Face tension", 0, 1],
                  ["jaw_openness", "Jaw open", 0, 1],
                ].map(([field, label, min, max]) => (
                  <label key={field}>
                    <span>{label}</span>
                    <input
                      max={max}
                      min={min}
                      onChange={(event) =>
                        updateArticulation("face", field, event.target.value)
                      }
                      step=".01"
                      type="range"
                      value={articulation.face[field]}
                    />
                    <output>
                      {Math.round(articulation.face[field] * 100)}
                    </output>
                  </label>
                ))}
                {[
                  ["hand_left", "Left hand"],
                  ["hand_right", "Right hand"],
                ].map(([group, label]) => (
                  <div className="pose-designer__hand-controls" key={group}>
                    <div className="pose-designer__control-heading">
                      <h4>{label}</h4>
                      <button
                        className="btn btn--light btn--small"
                        onClick={() => resetHand(group)}
                        type="button"
                      >
                        Reset
                      </button>
                    </div>
                    {["fist_closure", "finger_spread", "palm_turn"].map((field) => (
                      <label key={field}>
                        <span>
                          {field === "fist_closure"
                            ? "Fist close"
                            : field === "finger_spread"
                              ? "Finger spread"
                              : "Palm turn inward / down"}
                        </span>
                        <input
                          max="1"
                          min="0"
                          onChange={(event) =>
                            updateArticulation(group, field, event.target.value)
                          }
                          step=".01"
                          type="range"
                          value={articulation[group][field]}
                        />
                        <output>
                          {Math.round(articulation[group][field] * 100)}
                        </output>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        ) : null}
      </div>
      {anglesOpen ? (
        <div className="pose-designer__data-docks">
          <div className="pose-designer__angles pose-designer__angles--dock">
            <div className="pose-designer__angles-heading">
              <label>
                Angle ±
                <input
                  max="45"
                  min="1"
                  onChange={(event) => setTolerance(Number(event.target.value))}
                  type="number"
                  value={tolerance}
                />
                °
              </label>
              <label>
                Position ±
                <input
                  max=".5"
                  min=".01"
                  onChange={(event) =>
                    setPositionTolerance(Number(event.target.value))
                  }
                  step=".01"
                  type="number"
                  value={positionTolerance}
                />
              </label>
              <button
                className="btn btn--light btn--small"
                onClick={apply}
                type="button"
              >
                Apply pose
              </button>
            </div>
            <div className="pose-designer__angle-list">
              {calculated.map((item) => (
                <div key={item.body_part}>
                  <span>
                    {item.label}
                    <small>
                      {` ${anatomicalLimits(item.body_part).min}–${anatomicalLimits(item.body_part).max}°`}
                    </small>
                  </span>
                  <label className="pose-designer__angle-input">
                    <input
                      max={anatomicalLimits(item.body_part).max}
                      min={anatomicalLimits(item.body_part).min}
                      onBlur={() => commitAngleTarget(item.body_part)}
                      onChange={(event) => {
                        updateAngleDraft(item.body_part, event.target.value);
                        applyAngleTarget(item.body_part, event.target.value);
                      }}
                      onFocus={() => setActiveAngleInput(item.body_part)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitAngleTarget(item.body_part);
                        }
                      }}
                      step="1"
                      type="number"
                      value={draftAngleValues[item.body_part] ?? ""}
                    />
                    <span>°</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
          <div className="pose-designer__positions-dock">
            <header>
              <strong>Joint positions</strong>
              <span>Manual XYZ · fixed bone lengths</span>
            </header>
            <div className="pose-designer__position-groups">
              {POSITION_GROUPS.map((group) => (
                <section key={group.label}>
                  <h4>{group.label}</h4>
                  <div className="pose-designer__position-list">
                    {group.joints.map((name) => {
                      const position = pose[name];
                      return (
                        <article
                          className={
                            selectedJoint === name ? "is-selected" : ""
                          }
                          key={name}
                        >
                          <button
                            onClick={() => setSelectedJoint(name)}
                            type="button"
                          >
                            {jointLabel(name)}
                          </button>
                          {["X", "Y", "Z"].map((axis, index) => (
                            <label
                              className={`is-${axis.toLowerCase()}`}
                              key={axis}
                            >
                              <span>{axis}</span>
                              <input
                                aria-label={`${jointLabel(name)} ${axis}`}
                                onChange={(event) =>
                                  updateJointCoordinate(
                                    name,
                                    index,
                                    event.target.value,
                                  )
                                }
                                step=".01"
                                type="number"
                                value={position[index]}
                              />
                            </label>
                          ))}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
