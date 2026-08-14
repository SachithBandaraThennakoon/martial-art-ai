import { Line, useGLTF } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

const MODEL_URL = "/models/mediapipe_wireframe_human.glb";
const MAJOR_MAP = {
  pelvis: ["hip_left", "hip_right"],
  chest: ["shoulder_left", "shoulder_right"],
  l_shoulder: "shoulder_left",
  r_shoulder: "shoulder_right",
  l_elbow: "elbow_left",
  r_elbow: "elbow_right",
  l_wrist: "wrist_left",
  r_wrist: "wrist_right",
  l_hip: "hip_left",
  r_hip: "hip_right",
  l_knee: "knee_left",
  r_knee: "knee_right",
  l_ankle: "ankle_left",
  r_ankle: "ankle_right",
  l_toe: "foot_left",
  r_toe: "foot_right",
};

const PRIMARY_NAMES = new Set([
  "pelvis", "spine1", "chest", "neck", "head_c",
  "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
  "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle", "l_heel", "r_heel", "l_toe", "r_toe",
]);

const point = (value) => new THREE.Vector3(...value);
const average = (first, second) => point(first).add(point(second)).multiplyScalar(0.5);

function geometryCenter(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
}

function endpointNames(edgeName, landmarkNames) {
  const suffix = edgeName.replace(/^edge_\d+_/, "");
  for (const first of landmarkNames) {
    const prefix = `${first}_`;
    if (suffix.startsWith(prefix)) {
      const second = suffix.slice(prefix.length);
      if (landmarkNames.has(second)) return [first, second];
    }
  }
  return null;
}

function bodyFrame(source, landmarks) {
  const sourcePelvis = source.pelvis;
  const sourceAcross = source.r_hip.clone().sub(source.l_hip).normalize();
  const sourceUp = source.chest.clone().sub(source.pelvis).normalize();
  const sourceForward = sourceAcross.clone().cross(sourceUp).normalize();
  const targetPelvis = average(landmarks.hip_left, landmarks.hip_right);
  const targetChest = average(landmarks.shoulder_left, landmarks.shoulder_right);
  const targetAcross = point(landmarks.shoulder_right).sub(point(landmarks.shoulder_left)).normalize();
  const targetUp = targetChest.clone().sub(targetPelvis).normalize();
  const targetForward = targetAcross.clone().cross(targetUp).normalize();
  if (targetForward.z < 0) targetForward.negate();
  const sourceTorso = source.chest.distanceTo(source.pelvis);
  const scale = targetChest.distanceTo(targetPelvis) / sourceTorso;
  const transform = (sourcePoint) => {
    const offset = sourcePoint.clone().sub(sourcePelvis);
    return targetPelvis.clone()
      .addScaledVector(targetAcross, offset.dot(sourceAcross) * scale)
      .addScaledVector(targetUp, offset.dot(sourceUp) * scale)
      .addScaledVector(targetForward, offset.dot(sourceForward) * scale);
  };
  return { scale, targetChest, targetForward, targetPelvis, targetUp, transform };
}

function mapAttachedGroup({ anchorName, names, pivotName, source, target, targetPivot, targetDirection, frame }) {
  const sourcePivot = source[pivotName];
  const sourceDirection = frame.transform(source[pivotName]).sub(frame.transform(source[anchorName])).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(sourceDirection, targetDirection);
  names.forEach((name) => {
    const relative = frame.transform(source[name]).sub(frame.transform(sourcePivot)).applyQuaternion(rotation);
    target[name] = targetPivot.clone().add(relative);
  });
}

function buildTargetPoints(source, landmarks) {
  const frame = bodyFrame(source, landmarks);
  const target = Object.fromEntries(Object.entries(source).map(([name, sourcePoint]) => [name, frame.transform(sourcePoint)]));
  Object.entries(MAJOR_MAP).forEach(([name, mapping]) => {
    target[name] = Array.isArray(mapping)
      ? average(landmarks[mapping[0]], landmarks[mapping[1]])
      : point(landmarks[mapping]);
  });
  target.spine1 = target.pelvis.clone().lerp(target.chest, 0.48);
  target.neck = target.chest.clone().lerp(point(landmarks.head), 0.52);
  target.head_c = point(landmarks.head);

  ["l", "r"].forEach((side) => {
    const ankle = target[`${side}_ankle`];
    const toe = target[`${side}_toe`];
    target[`${side}_heel`] = ankle.clone().lerp(toe, -0.25).addScaledVector(frame.targetUp, -0.035);
    const handNames = Object.keys(source).filter((name) => name.startsWith(`${side}h`));
    const wristName = `${side}_wrist`;
    const elbowName = `${side}_elbow`;
    const direction = target[wristName].clone().sub(target[elbowName]).normalize();
    mapAttachedGroup({
      anchorName: elbowName,
      frame,
      names: handNames,
      pivotName: `${side}h0`,
      source,
      target,
      targetDirection: direction,
      targetPivot: target[wristName],
    });
  });
  return { points: target, scale: frame.scale };
}

function segmentMatrix(sourceFrom, sourceTo, targetFrom, targetTo) {
  const sourceDirection = sourceTo.clone().sub(sourceFrom);
  const targetDirection = targetTo.clone().sub(targetFrom);
  const scale = targetDirection.length() / Math.max(sourceDirection.length(), 0.0001);
  const rotation = new THREE.Quaternion().setFromUnitVectors(sourceDirection.normalize(), targetDirection.normalize());
  return new THREE.Matrix4().makeTranslation(...targetFrom.toArray())
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(...sourceFrom.clone().negate().toArray()));
}

export default function GuideGlbSkeleton({ highlights, landmarks, trajectory }) {
  const gltf = useGLTF(MODEL_URL);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const { edges, landmarks: modelLandmarks, source } = useMemo(() => {
    const sourcePoints = {};
    const landmarkMeshes = {};
    const edgeMeshes = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      if (object.name.startsWith("edge_")) edgeMeshes.push(object);
      else {
        sourcePoints[object.name] = geometryCenter(object);
        landmarkMeshes[object.name] = object;
      }
    });
    const names = new Set(Object.keys(sourcePoints));
    return {
      edges: edgeMeshes.map((mesh) => ({ mesh, endpoints: endpointNames(mesh.name, names) })).filter((edge) => edge.endpoints),
      landmarks: landmarkMeshes,
      source: sourcePoints,
    };
  }, [model]);
  const target = useMemo(() => buildTargetPoints(source, landmarks), [landmarks, source]);
  const materials = useMemo(() => ({
    active: new THREE.MeshBasicMaterial({ color: "#f4c95d" }),
    head: new THREE.MeshBasicMaterial({ color: "#c9b8ff", transparent: true, opacity: 0.9 }),
    primary: new THREE.MeshBasicMaterial({ color: "#bcefff" }),
    secondary: new THREE.MeshBasicMaterial({ color: "#2d83a8", transparent: true, opacity: 0.62 }),
  }), []);

  useLayoutEffect(() => {
    Object.entries(modelLandmarks).forEach(([name, mesh]) => {
      const targetPoint = target.points[name];
      if (!targetPoint) return;
      const scale = PRIMARY_NAMES.has(name) ? target.scale : target.scale * 0.82;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(new THREE.Matrix4().makeTranslation(...targetPoint.toArray())
        .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
        .multiply(new THREE.Matrix4().makeTranslation(...source[name].clone().negate().toArray())));
      mesh.material = highlights.has(name.replace(/^l_/, "").replace(/^r_/, ""))
        ? materials.active
        : name.startsWith("h") ? materials.head : PRIMARY_NAMES.has(name) ? materials.primary : materials.secondary;
    });
    edges.forEach(({ endpoints, mesh }) => {
      const [from, to] = endpoints;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(segmentMatrix(source[from], source[to], target.points[from], target.points[to]));
      const active = [from, to].some((name) => {
        const normalized = name.replace(/^l_/, "").replace(/^r_/, "");
        return [...highlights].some((highlight) => highlight.endsWith(normalized));
      });
      mesh.material = active ? materials.active
        : PRIMARY_NAMES.has(from) && PRIMARY_NAMES.has(to) ? materials.primary : materials.secondary;
    });
  }, [edges, highlights, materials, modelLandmarks, source, target]);

  return <group>
    <primitive object={model} />
    {trajectory.length > 1 ? <Line color="#f4c95d" dashed dashScale={12} lineWidth={2} opacity={0.72} points={trajectory} transparent /> : null}
  </group>;
}

useGLTF.preload(MODEL_URL);
