import { Canvas, useLoader, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Line,
  OrbitControls,
  TransformControls,
} from "@react-three/drei";
import {
  Suspense,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import PoseStudioContext from "./PoseStudioContext";
import MediaPipeSkeleton3D from "./MediaPipeSkeleton3D";
import { manualPoseToMediaPipePreview } from "../skeleton/manualPoseAdapter";

const DEFAULT_POSE = {
  head: [0, 1.65, 0],
  shoulder_left: [-0.52, 1.15, 0],
  shoulder_right: [0.52, 1.15, 0],
  elbow_left: [-0.84, 0.67, 0.02],
  elbow_right: [0.84, 0.67, 0.02],
  wrist_left: [-0.62, 0.18, 0.05],
  wrist_right: [0.62, 0.18, 0.05],
  hip_left: [-0.38, 0.1, 0],
  hip_right: [0.38, 0.1, 0],
  knee_left: [-0.43, -0.78, 0.04],
  knee_right: [0.43, -0.78, 0.04],
  ankle_left: [-0.39, -1.6, 0],
  ankle_right: [0.39, -1.6, 0],
  foot_left: [-0.42, -1.72, 0.35],
  foot_right: [0.42, -1.72, 0.35],
};
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
const DEFAULT_HUMAN_MODEL_URL = `${import.meta.env.BASE_URL}models/human/male_human_low-poly_base.glb`;
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
    finger_spread: 0.35,
    wrist_rotation: [0, 0, 0],
  },
  hand_right: {
    fist_closure: 0,
    finger_spread: 0.35,
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
function normalizedArticulation(value) {
  return Object.fromEntries(
    Object.entries(DEFAULT_ARTICULATION).map(([group, defaults]) => [
      group,
      { ...defaults, ...(value?.[group] || {}) },
    ]),
  );
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

function poseFromReferencePose(referencePose) {
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

function enforceAllBoneLengths(pose, pinnedJoint) {
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
        Math.abs(distance - LINK_LENGTHS[`${first}:${second}`]),
      );
      const error = (distance - LINK_LENGTHS[`${first}:${second}`]) / distance;
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

function ImportedHumanModel({ articulation, opacity, pose, url }) {
  const gltf = useLoader(GLTFLoader, url);
  const prepared = useMemo(() => {
    const scene = cloneSkeleton(gltf.scene);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = size.y > 0.0001 ? 3.42 / size.y : 1;
    scene.traverse((object) => {
      if (!object.isMesh) return;
      object.frustumCulled = false;
      object.castShadow = true;
      object.receiveShadow = true;
      object.material = new THREE.MeshStandardMaterial({
        color: "#eef2f6",
        depthWrite: opacity >= 1,
        emissive: "#080a0d",
        metalness: 0.04,
        opacity,
        roughness: 0.72,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
      });
    });
    const restRotations = new Map();
    scene.traverse((object) => {
      if (object.isBone) restRotations.set(object.name, object.quaternion.clone());
    });
    return {
      position: [
        -center.x * scale,
        FLOOR_Y - bounds.min.y * scale,
        -center.z * scale,
      ],
      scale,
      scene,
      restRotations,
    };
  }, [gltf.scene, opacity]);
  useLayoutEffect(() => {
    const { restRotations, scene } = prepared;
    restRotations.forEach((quaternion, name) => {
      scene.getObjectByName(name)?.quaternion.copy(quaternion);
    });
    scene.updateMatrixWorld(true);

    const calibratedTerminalAxis = (boneName, from, to) => {
      const bone = scene.getObjectByName(boneName);
      if (!bone?.isBone) return [0, 1, 0];
      const bindDirection = new THREE.Vector3(...to)
        .sub(new THREE.Vector3(...from))
        .normalize();
      return bindDirection
        .applyQuaternion(
          bone.getWorldQuaternion(new THREE.Quaternion()).invert(),
        )
        .toArray();
    };
    const leftFootAxis = calibratedTerminalAxis(
      "Left_ankle_045",
      DEFAULT_POSE.ankle_right,
      DEFAULT_POSE.foot_right,
    );
    const rightFootAxis = calibratedTerminalAxis(
      "Right_ankle_048",
      DEFAULT_POSE.ankle_left,
      DEFAULT_POSE.foot_left,
    );

    const aimBone = (boneName, childName, from, to) => {
      const bone = scene.getObjectByName(boneName);
      const child = scene.getObjectByName(childName);
      if (!bone?.isBone || !child?.isBone) return;
      const currentDirection = child
        .getWorldPosition(new THREE.Vector3())
        .sub(bone.getWorldPosition(new THREE.Vector3()))
        .normalize();
      const desiredDirection = new THREE.Vector3(...to)
        .sub(new THREE.Vector3(...from))
        .normalize();
      if (!currentDirection.lengthSq() || !desiredDirection.lengthSq()) return;
      const delta = new THREE.Quaternion().setFromUnitVectors(
        currentDirection,
        desiredDirection,
      );
      const desiredWorldRotation = delta.multiply(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      );
      const parentWorldRotation = bone.parent.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      bone.quaternion.copy(
        parentWorldRotation.invert().multiply(desiredWorldRotation),
      );
      scene.updateMatrixWorld(true);
    };
    const aimTerminalBone = (boneName, localAxis, from, to) => {
      const bone = scene.getObjectByName(boneName);
      if (!bone?.isBone) return;
      const currentDirection = new THREE.Vector3(...localAxis)
        .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const desiredDirection = new THREE.Vector3(...to)
        .sub(new THREE.Vector3(...from))
        .normalize();
      if (!desiredDirection.lengthSq()) return;
      const delta = new THREE.Quaternion().setFromUnitVectors(
        currentDirection,
        desiredDirection,
      );
      const desiredWorldRotation = delta.multiply(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      );
      const parentWorldRotation = bone.parent.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      bone.quaternion.copy(
        parentWorldRotation.invert().multiply(desiredWorldRotation),
      );
      scene.updateMatrixWorld(true);
    };

    const shoulderCenter = pose.shoulder_left.map(
      (value, axis) => (value + pose.shoulder_right[axis]) / 2,
    );
    const hipCenter = pose.hip_left.map(
      (value, axis) => (value + pose.hip_right[axis]) / 2,
    );
    aimBone("Spine_02", "Chest_03", hipCenter, shoulderCenter);
    aimBone("Neck_04", "Head_05", shoulderCenter, pose.head);
    aimBone(
      "Left_arm_07",
      "Left_elbow_08",
      pose.shoulder_right,
      pose.elbow_right,
    );
    aimBone(
      "Left_elbow_08",
      "Left_wrist_09",
      pose.elbow_right,
      pose.wrist_right,
    );
    aimBone(
      "Right_arm_025",
      "Right_elbow_026",
      pose.shoulder_left,
      pose.elbow_left,
    );
    aimBone(
      "Right_elbow_026",
      "Right_wrist_027",
      pose.elbow_left,
      pose.wrist_left,
    );
    aimBone("Left_leg_043", "Left_knee_044", pose.hip_right, pose.knee_right);
    aimBone(
      "Left_knee_044",
      "Left_ankle_045",
      pose.knee_right,
      pose.ankle_right,
    );
    aimBone(
      "Right_leg_046",
      "Right_knee_047",
      pose.hip_left,
      pose.knee_left,
    );
    aimBone(
      "Right_knee_047",
      "Right_ankle_048",
      pose.knee_left,
      pose.ankle_left,
    );
    // This GLB has no toe bones. Its ankle bone owns the complete foot mesh,
    // so use the bind-calibrated authoring direction instead of assuming one
    // of the asset's local axes points toward the toes.
    aimTerminalBone(
      "Left_ankle_045",
      leftFootAxis,
      pose.ankle_right,
      pose.foot_right,
    );
    aimTerminalBone(
      "Right_ankle_048",
      rightFootAxis,
      pose.ankle_left,
      pose.foot_left,
    );

    const rotateModelWrist = (boneName, rotation) => {
      const bone = scene.getObjectByName(boneName);
      if (!bone?.isBone) return;
      const worldDelta = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...(rotation || [0, 0, 0]), "XYZ"),
      );
      const desiredWorldRotation = worldDelta.multiply(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      );
      const parentWorldRotation = bone.parent.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      bone.quaternion.copy(
        parentWorldRotation.invert().multiply(desiredWorldRotation),
      );
      scene.updateMatrixWorld(true);
    };
    rotateModelWrist(
      "Left_wrist_09",
      articulation.hand_right.wrist_rotation,
    );
    rotateModelWrist(
      "Right_wrist_027",
      articulation.hand_left.wrist_rotation,
    );

    const curlBone = (name, xDegrees, zDegrees = 0) => {
      const bone = scene.getObjectByName(name);
      if (!bone?.isBone) return;
      bone.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(xDegrees),
            0,
            THREE.MathUtils.degToRad(zDegrees),
            "XYZ",
          ),
        ),
      );
    };
    const curlHand = (modelSide, closure) => {
      const sideCode = modelSide === "L" ? "L" : "R";
      const fingerNames =
        modelSide === "L"
          ? [
              ["Middle_finger0_L_010", "Middle_finger1_L_00", "Middle_finger2_L_011"],
              ["Ring_finger0_L_012", "Ring_finger1_L_013", "Ring_finger2_L_014"],
              ["Little_finger0_L_015", "Little_finger1_L_016", "Little_finger2_L_017"],
              ["Index_finger0_L_018", "Index_finger1_L_019", "Index_finger2_L_020"],
            ]
          : [
              ["Middle_finger0_R_028", "Middle_finger1_R_029", "Middle_finger2_R_030"],
              ["Ring_finger0_R_031", "Ring_finger1_R_032", "Ring_finger2_R_033"],
              ["Little_finger0_R_034", "Little_finger1_R_035", "Little_finger2_R_036"],
              ["Index_finger0_R_037", "Index_finger1_R_038", "Index_finger2_R_039"],
            ];
      const easedClosure = THREE.MathUtils.smoothstep(closure, 0, 1);
      fingerNames.forEach((finger) => {
        // Curl as a three-joint chain. The previous values exceeded a natural
        // closed-fist arc and folded the fingertips through the palm/wrist.
        // The imported rig's local X flexion axis is opposite to the editor's
        // palm-depth direction after the model's 180-degree facing correction.
        curlBone(finger[0], -58 * easedClosure);
        curlBone(finger[1], -78 * easedClosure);
        curlBone(finger[2], -42 * easedClosure);
      });
      const thumbNames =
        sideCode === "L"
          ? ["Thumb0_L_021", "Thumb1_L_022", "Thumb2_L_023"]
          : ["Thumb0_R_040", "Thumb1_R_041", "Thumb2_R_042"];
      // Thumb bind rotations are mirrored. Rotate toward the palm first,
      // then bend the two distal joints over the curled index/middle fingers.
      const wrapDirection = sideCode === "L" ? 1 : -1;
      curlBone(
        thumbNames[0],
        -28 * easedClosure,
        wrapDirection * 45 * easedClosure,
      );
      curlBone(
        thumbNames[1],
        -48 * easedClosure,
        wrapDirection * 25 * easedClosure,
      );
      curlBone(
        thumbNames[2],
        -32 * easedClosure,
        wrapDirection * 10 * easedClosure,
      );
    };
    // The model is rotated 180 degrees, so its anatomical left hand appears
    // on the editor's right side and vice versa.
    curlHand("L", articulation.hand_right.fist_closure);
    curlHand("R", articulation.hand_left.fist_closure);
    scene.updateMatrixWorld(true);
  }, [articulation, pose, prepared]);
  return (
    <primitive
      object={prepared.scene}
      position={prepared.position}
      rotation={[0, Math.PI, 0]}
      scale={prepared.scale}
    />
  );
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

const ArticulationOverlay = memo(function ArticulationOverlay({
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
  const makeHand = (side) => {
    const elbow = new THREE.Vector3(...pose[`elbow_${side}`]);
    const wrist = new THREE.Vector3(...pose[`wrist_${side}`]);
    const direction = wrist.clone().sub(elbow).normalize();
    let widthAxis = forward.clone().cross(direction).normalize();
    if (widthAxis.lengthSq() < 0.01) widthAxis = right.clone();
    const settings = articulation[`hand_${side}`];
    const wristQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(settings.wrist_rotation || [0, 0, 0]), "XYZ"),
    );
    direction.applyQuaternion(wristQuaternion);
    widthAxis.applyQuaternion(wristQuaternion);
    const depthAxis = direction.clone().cross(widthAxis).normalize();
    const torsoOffset = shoulderLeft
      .clone()
      .add(shoulderRight)
      .multiplyScalar(0.5)
      .sub(wrist);
    const inwardCurlAxis = torsoOffset
      .clone()
      .addScaledVector(
        direction,
        -torsoOffset.dot(direction),
      )
      .normalize();
    if (inwardCurlAxis.lengthSq() < 0.01) inwardCurlAxis.copy(depthAxis).negate();
    const closure = settings.fist_closure;
    const spreadScale = 0.4 + settings.finger_spread;
    const landmarks = Array(21);
    landmarks[0] = wrist.toArray();
    const fingerOffsets = [-0.078, -0.026, 0.026, 0.078];
    const fingerBases = [5, 9, 13, 17];
    fingerBases.forEach((baseIndex, fingerIndex) => {
      const lateral = fingerOffsets[fingerIndex] * spreadScale;
      const easedClosure = THREE.MathUtils.smoothstep(closure, 0, 1);
      let fingerPoint = wrist
        .clone()
        .add(direction.clone().multiplyScalar(0.065))
        .add(widthAxis.clone().multiplyScalar(lateral));
      landmarks[baseIndex] = fingerPoint.toArray();
      const segmentLengths = [0.07, 0.062, 0.052];
      // Cumulative segment directions for a closed fist. The proximal segment
      // folds into the palm first; the last two then wrap back toward the
      // knuckles instead of stopping in an open claw.
      const bendAngles = [58, 132, 174];
      segmentLengths.forEach((length, segmentIndex) => {
        const angle = THREE.MathUtils.degToRad(
          bendAngles[segmentIndex] * easedClosure,
        );
        const segmentDirection = direction
          .clone()
          .multiplyScalar(Math.cos(angle))
          .add(inwardCurlAxis.clone().multiplyScalar(Math.sin(angle)))
          .normalize();
        fingerPoint = fingerPoint
          .clone()
          .add(segmentDirection.multiplyScalar(length));
        landmarks[baseIndex + segmentIndex + 1] = fingerPoint.toArray();
      });
    });
    const thumbSign = side === "left" ? -1 : 1;
    for (let joint = 1; joint <= 4; joint += 1) {
      const progress = joint / 4;
      const openPoint = wrist
        .clone()
        .add(
          direction
            .clone()
            .multiplyScalar(0.03 + progress * 0.145),
        )
        .add(
          widthAxis
            .clone()
            .multiplyScalar(thumbSign * (0.04 + progress * 0.105)),
        );
      const closedPoint = wrist
        .clone()
        .add(
          direction
            .clone()
            .multiplyScalar(0.05 + Math.sin(progress * Math.PI) * 0.065),
        )
        .add(
          widthAxis
            .clone()
            .multiplyScalar(thumbSign * (0.055 - progress * 0.03)),
        )
        .add(
          inwardCurlAxis
            .clone()
            .multiplyScalar(0.03 + progress * 0.1),
        );
      landmarks[joint] = openPoint
        .lerp(closedPoint, closure)
        .toArray();
    }
    return landmarks;
  };
  const hands = { left: makeHand("left"), right: makeHand("right") };
  return (
    <>
      <Line color="#ffffff" lineWidth={1.4} points={faceOutline} />
      <Line
        color="#ffffff"
        lineWidth={1.35}
        points={[faceOutline[3], neck.toArray()]}
      />
      <Line
        color="#ffffff"
        lineWidth={1.25}
        opacity={0.82}
        points={[shoulderLeft.toArray(), neck.toArray(), shoulderRight.toArray()]}
        transparent
      />
      <Line
        color="#ffffff"
        lineWidth={1.15}
        opacity={0.78}
        points={[faceOutline[0], gazePoint, faceOutline[1]]}
        transparent
      />
      <Line
        color="#ffffff"
        lineWidth={1.05}
        opacity={0.68}
        points={[faceOutline[4], gazePoint, faceOutline[2]]}
        transparent
      />
      {Object.entries(hands).map(([side, landmarks]) => (
        <group key={side}>
          {HAND_CONNECTIONS.map(([from, to]) => (
            <Line
              color="#ffffff"
              depthTest={false}
              key={`${from}-${to}`}
              lineWidth={1.35}
              points={[landmarks[from], landmarks[to]]}
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
              <meshStandardMaterial
                color="#ffffff"
                depthTest={false}
                depthWrite={false}
              />
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

const FootDetailOverlay = memo(function FootDetailOverlay({ pose }) {
  return (
    <>
      {["left", "right"].map((side) => {
        const ankle = new THREE.Vector3(...pose[`ankle_${side}`]);
        const foot = new THREE.Vector3(...pose[`foot_${side}`]);
        const direction = foot.clone().sub(ankle).normalize();
        const perpendicular = new THREE.Vector3(
          -direction.z,
          0,
          direction.x,
        ).normalize();
        const toes = [-1, 0, 1].map((offset) =>
          foot
            .clone()
            .add(
              direction.clone().multiplyScalar(0.13 - Math.abs(offset) * 0.018),
            )
            .add(perpendicular.clone().multiplyScalar(offset * 0.045))
            .toArray(),
        );
        return (
          <group key={side}>
            {toes.map((toe, index) => (
              <group key={index}>
                <Line
                  color="#ffffff"
                  lineWidth={1.15}
                  points={[pose[`foot_${side}`], toe]}
                />
                <mesh position={toe}>
                  <sphereGeometry args={[0.012, 8, 6]} />
                  <meshStandardMaterial color="#ffffff" emissive="#222222" />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </>
  );
});

function PoseScene({
  articulation,
  guidesVisible,
  modelUrl,
  pose,
  poseScale,
  selectedJoint,
  transformMode,
  rotation,
  rotationSnap,
  viewMode,
  onSelectJoint,
  onMoveJoint,
  onRotateJoint,
}) {
  const studio = useContext(PoseStudioContext);
  const { camera } = useThree();
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
    if (viewMode === "split") camera.position.set(0, 0.8, 12);
    else camera.position.set(2.8, 1.3, 5.1);
    camera.lookAt(0, 0, 0);
  }, [camera, studio, viewMode]);
  useEffect(() => {
    if (isTransforming.current) return;
    transformTarget.position.fromArray(pose[selectedJoint]);
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
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={["#ef5350", "#60d394", "#6aa8ff"]}
          labelColor="white"
        />
      </GizmoHelper>
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
        {modelUrl && viewMode !== "skeleton" ? (
          <Suspense fallback={null}>
              <ImportedHumanModel
                articulation={articulation}
                opacity={1}
                pose={pose}
                url={modelUrl}
              />
          </Suspense>
        ) : null}
        {viewMode === "model" ? (
          <ContactShadows
            blur={2.4}
            far={4.5}
            opacity={0.42}
            position={[0, FLOOR_Y + 0.012, 0]}
            resolution={1024}
            scale={5.5}
          />
        ) : null}
        {viewMode !== "model" ? (
          <group>
            <MediaPipeSkeleton3D
              jointRadius={0.025}
              landmarks={mediaPipePreview}
              lineWidth={1.45}
            />
            {Object.entries(pose).map(([name, position]) => (
              <mesh
                key={name}
                onClick={(event) => chooseJoint(event, name)}
                position={position}
                scale={selectedJoint === name ? 1.28 : 1}
              >
                <sphereGeometry
                  args={[
                    name.startsWith("wrist_") ? 0.027 : 0.04,
                    16,
                    12,
                  ]}
                />
                <meshStandardMaterial
                  color="#60d394"
                  emissive={selectedJoint === name ? "#49d789" : "#173d2a"}
                />
              </mesh>
            ))}
            <ArticulationOverlay articulation={articulation} pose={pose} />
          </group>
        ) : null}
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
      {viewMode === "skeleton" ? (
        <TransformControls
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
        />
      ) : null}
      <OrbitControls
        makeDefault
        maxDistance={12}
        minDistance={3}
        target={[0, 0, 0]}
      />
    </>
  );
}

export default function PoseRangeDesigner({
  emitInitialPoseChange = true,
  initialAngleTolerance = 12,
  onApply,
  onPoseChange,
  rangeTargets = [],
  referencePose = null,
  studioActions = null,
  studioLead = null,
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
  const modelUrl = DEFAULT_HUMAN_MODEL_URL;
  const [viewMode, setViewMode] = useState("model");
  const [articulation, setArticulation] = useState(() =>
    normalizedArticulation(referencePose?.articulation),
  );
  const initialPoseStateSignature = useRef(
    JSON.stringify({ articulation, pose, positionTolerance, tolerance }),
  );
  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === workbenchRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
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
  const renderPoseCanvas = (mode) => (
    <Canvas
      camera={{ fov: 32, position: [2.8, 1.3, 5.1] }}
      key={mode}
      shadows
    >
      <color attach="background" args={["#0c121b"]} />
      <PoseScene
        articulation={articulation}
        guidesVisible={guidesVisible}
        modelUrl={modelUrl}
        onMoveJoint={moveJoint}
        onRotateJoint={rotateJoint}
        onSelectJoint={setSelectedJoint}
        pose={pose}
        poseScale={1.35}
        rotation={selectedRotation}
        rotationSnap={rotationSnap}
        selectedJoint={selectedJoint}
        transformMode={transformMode}
        viewMode={mode}
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
          {modelUrl ? (
            <div className="pose-designer__mode-switch" aria-label="Model view mode">
              {["skeleton", "model", "split"].map((mode) => (
                <button
                  className={viewMode === mode ? "is-active" : ""}
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  type="button"
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          ) : null}
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
      <div
        className={`pose-designer__workbench ${inspectorOpen ? "" : "is-inspector-collapsed"}`}
      >
        <div className="pose-designer__viewport">
          <div className="pose-designer__viewport-bar">
            <span>Perspective</span>
            <span>Pose collection / {selectedJoint}</span>
          </div>
          {viewMode === "split" ? (
            <div className="pose-designer__split-view">
              <div>{renderPoseCanvas("skeleton")}</div>
              <div>{renderPoseCanvas("model")}</div>
            </div>
          ) : (
            renderPoseCanvas(viewMode)
          )}
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
                <h4>Face controls</h4>
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
                    <h4>{label}</h4>
                    {["fist_closure", "finger_spread"].map((field) => (
                      <label key={field}>
                        <span>
                          {field === "fist_closure"
                            ? "Fist close"
                            : "Finger spread"}
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
