import { useGLTF } from "@react-three/drei";
import { memo, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import { buildHandLandmarks } from "../skeleton/handLandmarks";

const MODEL_URL = "/models/athletic_human_body_source.glb";
const SOURCE_POINTS = {
  head: [0, 0.01, -2.01],
  neck: [0, 0, -1.82],
  shoulder_left: [-0.27, 0, -1.7],
  shoulder_right: [0.27, 0, -1.7],
  elbow_left: [-0.54, 0, -1.48],
  elbow_right: [0.54, 0, -1.48],
  wrist_left: [-0.76, 0, -1.27],
  wrist_right: [0.76, 0, -1.27],
  hand_left: [-0.85, 0, -1.18],
  hand_right: [0.85, 0, -1.18],
  hip_left: [-0.12, 0, -1.05],
  hip_right: [0.12, 0, -1.05],
  knee_left: [-0.15, 0, -0.55],
  knee_right: [0.15, 0, -0.55],
  ankle_left: [-0.18, 0, -0.1],
  ankle_right: [0.18, 0, -0.1],
  foot_left: [-0.18, 0.18, -0.02],
  foot_right: [0.18, 0.18, -0.02],
};

const SOURCE_BONES = {
  head: ["neck", "head"],
  torso: ["hip_center", "shoulder_center"],
  upper_arm_left: ["shoulder_left", "elbow_left"],
  forearm_left: ["elbow_left", "wrist_left"],
  hand_left: ["wrist_left", "hand_left"],
  upper_arm_right: ["shoulder_right", "elbow_right"],
  forearm_right: ["elbow_right", "wrist_right"],
  hand_right: ["wrist_right", "hand_right"],
  thigh_left: ["hip_left", "knee_left"],
  shin_left: ["knee_left", "ankle_left"],
  foot_left: ["ankle_left", "foot_left"],
  thigh_right: ["hip_right", "knee_right"],
  shin_right: ["knee_right", "ankle_right"],
  foot_right: ["ankle_right", "foot_right"],
};

const REQUIRED_POSE_POINTS = [
  "head",
  "shoulder_left",
  "shoulder_right",
  "elbow_left",
  "elbow_right",
  "wrist_left",
  "wrist_right",
  "hip_left",
  "hip_right",
  "knee_left",
  "knee_right",
  "ankle_left",
  "ankle_right",
  "foot_left",
  "foot_right",
];

function hasCompletePose(pose) {
  return REQUIRED_POSE_POINTS.every((name) => {
    const point = pose?.[name];
    return (
      Array.isArray(point) &&
      point.length >= 3 &&
      point.slice(0, 3).every(Number.isFinite)
    );
  });
}

function vector(point) {
  return point instanceof THREE.Vector3 ? point.clone() : new THREE.Vector3(...point);
}

function midpoint(first, second) {
  return vector(first).add(vector(second)).multiplyScalar(0.5);
}

const SOURCE = {
  ...Object.fromEntries(
    Object.entries(SOURCE_POINTS).map(([name, point]) => [name, vector(point)]),
  ),
  hip_center: midpoint(SOURCE_POINTS.hip_left, SOURCE_POINTS.hip_right),
  shoulder_center: midpoint(
    SOURCE_POINTS.shoulder_left,
    SOURCE_POINTS.shoulder_right,
  ),
};

function segmentDistance(point, start, end) {
  const segment = end.clone().sub(start);
  const lengthSquared = Math.max(0.000001, segment.lengthSq());
  const progress = Math.max(
    0,
    Math.min(1, point.clone().sub(start).dot(segment) / lengthSquared),
  );
  return point.distanceTo(start.clone().addScaledVector(segment, progress));
}

function candidateBones(point) {
  const height = -point.z;
  const horizontal = Math.abs(point.x);
  const side = point.x < 0 ? "left" : "right";
  if (height > 1.81) return ["head", "torso"];
  if (horizontal > 0.24 && height > 1.1)
    return [
      `upper_arm_${side}`,
      `forearm_${side}`,
      `hand_${side}`,
      "torso",
    ];
  if (height < 1.11)
    return [`thigh_${side}`, `shin_${side}`, `foot_${side}`, "torso"];
  return ["torso", "head", `upper_arm_${side}`, `thigh_${side}`];
}

function buildSkinWeights(position) {
  const sourcePoint = vector(position);
  const ranked = candidateBones(sourcePoint)
    .map((bone) => {
      const [from, to] = SOURCE_BONES[bone];
      return {
        bone,
        distance: segmentDistance(sourcePoint, SOURCE[from], SOURCE[to]),
      };
    })
    .sort((first, second) => first.distance - second.distance)
    .slice(0, 2);
  if (ranked.length === 1) return [{ bone: ranked[0].bone, weight: 1 }];
  const firstStrength = 1 / Math.max(0.0025, ranked[0].distance ** 2);
  const secondStrength = 1 / Math.max(0.0025, ranked[1].distance ** 2);
  const total = firstStrength + secondStrength;
  return [
    { bone: ranked[0].bone, weight: firstStrength / total },
    { bone: ranked[1].bone, weight: secondStrength / total },
  ];
}

function betweenMatrix(sourceStart, sourceEnd, targetStart, targetEnd) {
  const sourceDirection = sourceEnd.clone().sub(sourceStart);
  const targetDirection = targetEnd.clone().sub(targetStart);
  const sourceLength = Math.max(0.0001, sourceDirection.length());
  const targetLength = Math.max(0.0001, targetDirection.length());
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    sourceDirection.normalize(),
    targetDirection.normalize(),
  );
  const scale = targetLength / sourceLength;
  return new THREE.Matrix4()
    .makeTranslation(...targetStart.toArray())
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(
      new THREE.Matrix4().makeTranslation(
        ...sourceStart.clone().negate().toArray(),
      ),
    );
}

function average(points) {
  return points
    .reduce((total, point) => total.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
}

function targetMatrices(pose, articulation) {
  const target = Object.fromEntries(
    Object.entries(pose).map(([name, point]) => [name, vector(point)]),
  );
  target.hip_center = midpoint(target.hip_left, target.hip_right);
  target.shoulder_center = midpoint(
    target.shoulder_left,
    target.shoulder_right,
  );
  // Pose Studio intentionally has no editable neck joint. Place the overlay's
  // neck between the shoulder line and head so its source head bone always has
  // a valid target segment.
  target.neck = target.shoulder_center.clone().lerp(target.head, 0.47);
  const torsoScale = target.shoulder_center.distanceTo(target.hip_center) /
    SOURCE.shoulder_center.distanceTo(SOURCE.hip_center);
  for (const side of ["left", "right"]) {
    const hand = buildHandLandmarks(pose, articulation, side)
      .map((point) => vector(point));
    const palmDirection = average([hand[5], hand[9], hand[13], hand[17]])
      .sub(hand[0])
      .normalize();
    const sourceHandLength = SOURCE[`hand_${side}`]
      .distanceTo(SOURCE[`wrist_${side}`]);
    target[`hand_${side}`] = target[`wrist_${side}`]
      .clone()
      .addScaledVector(palmDirection, sourceHandLength * torsoScale);
  }
  const matrices = {};
  Object.entries(SOURCE_BONES).forEach(([bone, [from, to]]) => {
    matrices[bone] = betweenMatrix(
      SOURCE[from],
      SOURCE[to],
      target[from],
      target[to],
    );
  });
  return matrices;
}

const AuthoringSkeletonGlbOverlay = memo(function AuthoringSkeletonGlbOverlay({
  articulation,
  pose,
}) {
  const gltf = useGLTF(MODEL_URL);
  const sourceMesh = useMemo(() => {
    let found = null;
    gltf.scene.traverse((object) => {
      if (!found && object.isMesh) found = object;
    });
    return found;
  }, [gltf.scene]);
  const prepared = useMemo(() => {
    if (!sourceMesh) return null;
    const geometry = sourceMesh.geometry.clone();
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const originalPositions = Float32Array.from(position.array);
    const originalNormals = normal ? Float32Array.from(normal.array) : null;
    const boneNames = Object.keys(SOURCE_BONES);
    const boneIndex = new Map(boneNames.map((name, index) => [name, index]));
    const indices = new Uint8Array(position.count * 2);
    const weights = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
      const influences = buildSkinWeights([
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      ]);
      influences.forEach((influence, influenceIndex) => {
        indices[index * 2 + influenceIndex] = boneIndex.get(influence.bone);
        weights[index * 2 + influenceIndex] = influence.weight;
      });
    }
    position.setUsage(THREE.DynamicDrawUsage);
    normal?.setUsage(THREE.DynamicDrawUsage);
    const material = sourceMesh.material.clone();
    material.color.set("#eef5f7");
    material.opacity = 0.28;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return {
      boneNames,
      geometry,
      indices,
      material,
      originalNormals,
      originalPositions,
      weights,
    };
  }, [sourceMesh]);

  useLayoutEffect(() => {
    if (!prepared || !hasCompletePose(pose)) return;
    const matricesByName = targetMatrices(pose, articulation);
    const matrices = prepared.boneNames.map((name) => matricesByName[name]);
    const normalMatrices = matrices.map(
      (matrix) => new THREE.Matrix3().getNormalMatrix(matrix),
    );
    const position = prepared.geometry.getAttribute("position");
    const normal = prepared.geometry.getAttribute("normal");
    const sourcePosition = new THREE.Vector3();
    const deformedPosition = new THREE.Vector3();
    const sourceNormal = new THREE.Vector3();
    const deformedNormal = new THREE.Vector3();
    const transformed = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      sourcePosition.fromArray(prepared.originalPositions, offset);
      deformedPosition.set(0, 0, 0);
      if (normal && prepared.originalNormals) {
        sourceNormal.fromArray(prepared.originalNormals, offset);
        deformedNormal.set(0, 0, 0);
      }
      for (let influence = 0; influence < 2; influence += 1) {
        const influenceOffset = index * 2 + influence;
        const weight = prepared.weights[influenceOffset];
        if (!weight) continue;
        const matrixIndex = prepared.indices[influenceOffset];
        transformed.copy(sourcePosition).applyMatrix4(matrices[matrixIndex]);
        deformedPosition.addScaledVector(transformed, weight);
        if (normal && prepared.originalNormals) {
          transformed.copy(sourceNormal).applyMatrix3(normalMatrices[matrixIndex]);
          deformedNormal.addScaledVector(transformed, weight);
        }
      }
      position.setXYZ(index, deformedPosition.x, deformedPosition.y, deformedPosition.z);
      if (normal && prepared.originalNormals) {
        deformedNormal.normalize();
        normal.setXYZ(index, deformedNormal.x, deformedNormal.y, deformedNormal.z);
      }
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
  }, [articulation, pose, prepared]);

  if (!prepared || !hasCompletePose(pose)) return null;
  return (
    <mesh
      frustumCulled={false}
      geometry={prepared.geometry}
      material={prepared.material}
      renderOrder={2}
    />
  );
});

useGLTF.preload(MODEL_URL);

export default AuthoringSkeletonGlbOverlay;
