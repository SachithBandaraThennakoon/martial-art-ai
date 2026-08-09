import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, TransformControls } from "@react-three/drei";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import PoseStudioContext from "./PoseStudioContext";

const DEFAULT_POSE = {
  head: [0, 1.65, 0], shoulder_left: [-0.52, 1.15, 0], shoulder_right: [0.52, 1.15, 0],
  elbow_left: [-0.84, 0.67, 0.02], elbow_right: [0.84, 0.67, 0.02],
  wrist_left: [-0.62, 0.18, 0.05], wrist_right: [0.62, 0.18, 0.05],
  hip_left: [-0.38, 0.1, 0], hip_right: [0.38, 0.1, 0], knee_left: [-0.43, -0.78, 0.04], knee_right: [0.43, -0.78, 0.04],
  ankle_left: [-0.39, -1.6, 0], ankle_right: [0.39, -1.6, 0], foot_left: [-0.42, -1.72, 0.35], foot_right: [0.42, -1.72, 0.35]
};
const LINKS = [["head", "shoulder_left"], ["head", "shoulder_right"], ["shoulder_left", "shoulder_right"], ["shoulder_left", "elbow_left"], ["elbow_left", "wrist_left"], ["shoulder_right", "elbow_right"], ["elbow_right", "wrist_right"], ["shoulder_left", "hip_left"], ["shoulder_right", "hip_right"], ["hip_left", "hip_right"], ["hip_left", "knee_left"], ["knee_left", "ankle_left"], ["ankle_left", "foot_left"], ["hip_right", "knee_right"], ["knee_right", "ankle_right"], ["ankle_right", "foot_right"]];
const ANGLES = [["elbow_left", "Left elbow", "shoulder_left", "elbow_left", "wrist_left"], ["elbow_right", "Right elbow", "shoulder_right", "elbow_right", "wrist_right"], ["shoulder_left", "Left shoulder", "elbow_left", "shoulder_left", "hip_left"], ["shoulder_right", "Right shoulder", "elbow_right", "shoulder_right", "hip_right"], ["hip_left", "Left hip", "shoulder_left", "hip_left", "knee_left"], ["hip_right", "Right hip", "shoulder_right", "hip_right", "knee_right"], ["knee_left", "Left knee", "hip_left", "knee_left", "ankle_left"], ["knee_right", "Right knee", "hip_right", "knee_right", "ankle_right"], ["ankle_left", "Left ankle", "knee_left", "ankle_left", "foot_left"], ["ankle_right", "Right ankle", "knee_right", "ankle_right", "foot_right"]];
const PARENT_JOINTS = { head: "shoulder_left", shoulder_left: "hip_left", shoulder_right: "shoulder_left", elbow_left: "shoulder_left", wrist_left: "elbow_left", hip_right: "hip_left", knee_left: "hip_left", ankle_left: "knee_left", foot_left: "ankle_left", knee_right: "hip_right", ankle_right: "knee_right", foot_right: "ankle_right" };
const CHILD_JOINTS = Object.entries(PARENT_JOINTS).reduce((children, [joint, parent]) => ({ ...children, [parent]: [...(children[parent] || []), joint] }), {});
const BONE_LENGTHS = Object.fromEntries(Object.entries(PARENT_JOINTS).map(([joint, parent]) => [joint, Math.hypot(...DEFAULT_POSE[joint].map((value, index) => value - DEFAULT_POSE[parent][index]))]));
const LINK_LENGTHS = Object.fromEntries(LINKS.map(([first, second]) => [`${first}:${second}`, Math.hypot(...DEFAULT_POSE[first].map((value, index) => value - DEFAULT_POSE[second][index]))]));
const ANGLE_JOINTS = Object.fromEntries(ANGLES.map(([id, , first, center, end]) => [id, { first, center, end }]));
const STUDIO_OFFSETS = { pose_a: [-2.35, 0, 0], optimal: [0, 0, 0], pose_b: [2.35, 0, 0] };
const TWO_POSE_OFFSETS = { pose_a: [-1.45, 0, 0], optimal: [1.45, 0, 0] };
const FLOOR_Y = -1.75;
const FOOT_CONTACT_Y = FLOOR_Y + .135;

function freshPose() { return Object.fromEntries(Object.entries(DEFAULT_POSE).map(([name, position]) => [name, [...position]])); }
function calculateAngle(first, center, last) { const left = first.map((value, index) => value - center[index]); const right = last.map((value, index) => value - center[index]); const denominator = Math.hypot(...left) * Math.hypot(...right); if (!denominator) return 0; const cosine = Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0) / denominator)); return Math.round(Math.acos(cosine) * 180 / Math.PI); }

function groundPose(pose) {
  const lowestFoot = Math.min(pose.foot_left[1], pose.foot_right[1]);
  const offset = FOOT_CONTACT_Y - lowestFoot;
  if (Math.abs(offset) < .00001) return pose;
  return Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, [position[0], Number((position[1] + offset).toFixed(3)), position[2]]]));
}

function plantedFootName(pose) {
  return pose.foot_left[1] <= pose.foot_right[1] ? "foot_left" : "foot_right";
}

function restorePlantedFootAndResolve(nextPose, previousPose, fallbackPinnedJoint) {
  const plantedFoot = plantedFootName(previousPose);
  const moved = Math.hypot(...nextPose[plantedFoot].map((value, index) => value - previousPose[plantedFoot][index])) > .0005;
  if (!moved) return enforceAllBoneLengths(nextPose, fallbackPinnedJoint);
  const restored = { ...nextPose, [plantedFoot]: [...previousPose[plantedFoot]] };
  return enforceAllBoneLengths(restored, plantedFoot);
}

function poseFrame(pose) {
  const hipCenter = pose.hip_left.map((value, index) => (value + pose.hip_right[index]) / 2);
  const shoulderCenter = pose.shoulder_left.map((value, index) => (value + pose.shoulder_right[index]) / 2);
  return { origin: hipCenter, scale: Math.max(.0001, Math.hypot(...shoulderCenter.map((value, index) => value - hipCenter[index]))) };
}

function referencePoseFromPose(pose, tolerance = .12) {
  const { origin, scale } = poseFrame(pose);
  const landmarks = Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, position.map((value, index) => Number(((value - origin[index]) / scale).toFixed(4)))]));
  return {
    schema_version: "1.0",
    coordinate_space: "body_normalized_v1",
    origin: "hip_center",
    scale_basis: "torso_length",
    tolerance: Number(tolerance.toFixed(3)),
    landmarks,
    bones: LINKS.map(([from, to]) => ({
      from,
      to,
      length: Number(Math.hypot(...landmarks[from].map((value, index) => value - landmarks[to][index])).toFixed(4))
    }))
  };
}

function poseFromReferencePose(referencePose) {
  if (referencePose?.coordinate_space !== "body_normalized_v1" || !referencePose.landmarks) return null;
  const canonical = freshPose();
  const { origin, scale } = poseFrame(canonical);
  const pose = { ...canonical };
  Object.entries(referencePose.landmarks).forEach(([name, position]) => {
    if (pose[name] && Array.isArray(position) && position.length === 3) pose[name] = position.map((value, index) => Number((origin[index] + Number(value) * scale).toFixed(3)));
  });
  // Preserve every supplied XYZ landmark exactly (apart from the uniform
  // body-normalized-to-studio transform). Re-solving bone lengths here would
  // change the angles, stance and rotations selected by the optimizer.
  return groundPose(pose);
}

function enforceAllBoneLengths(pose, pinnedJoint) {
  const next = Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, [...position]]));
  for (let iteration = 0; iteration < 24; iteration += 1) {
    let maximumError = 0;
    LINKS.forEach(([first, second]) => {
      const firstPosition = next[first];
      const secondPosition = next[second];
      const difference = secondPosition.map((value, index) => value - firstPosition[index]);
      const distance = Math.hypot(...difference);
      if (distance < .000001) return;
      maximumError = Math.max(maximumError, Math.abs(distance - LINK_LENGTHS[`${first}:${second}`]));
      const error = (distance - LINK_LENGTHS[`${first}:${second}`]) / distance;
      const firstPinned = first === pinnedJoint;
      const secondPinned = second === pinnedJoint;
      const firstShare = firstPinned ? 0 : secondPinned ? 1 : .5;
      const secondShare = secondPinned ? 0 : firstPinned ? 1 : .5;
      difference.forEach((value, index) => {
        next[first][index] += value * error * firstShare;
        next[second][index] -= value * error * secondShare;
      });
    });
    if (maximumError < .0005) break;
  }
  return Object.fromEntries(Object.entries(next).map(([name, position]) => [name, position.map((value) => Number(value.toFixed(3)))]));
}

function rotateBranch(pose, rootJoint, pivotJoint, radians) {
  const next = Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, [...position]]));
  const pivot = next[pivotJoint];
  const rotateJoint = (joint) => {
    const [x, y, z] = next[joint];
    const dx = x - pivot[0]; const dy = y - pivot[1];
    next[joint] = [pivot[0] + dx * Math.cos(radians) - dy * Math.sin(radians), pivot[1] + dx * Math.sin(radians) + dy * Math.cos(radians), z];
    (CHILD_JOINTS[joint] || []).forEach(rotateJoint);
  };
  rotateJoint(rootJoint);
  return next;
}

function rotateDescendants(pose, pivotJoint, quaternion) {
  const next = Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, [...position]]));
  const pivot = new THREE.Vector3(...next[pivotJoint]);
  const rotateJoint = (joint) => {
    const position = new THREE.Vector3(...next[joint]).sub(pivot).applyQuaternion(quaternion).add(pivot);
    next[joint] = position.toArray().map((value) => Number(value.toFixed(3)));
    (CHILD_JOINTS[joint] || []).forEach(rotateJoint);
  };
  (CHILD_JOINTS[pivotJoint] || []).forEach(rotateJoint);
  return restorePlantedFootAndResolve(next, pose, pivotJoint);
}

function poseFromAngleTargets(pose, angleTargets = []) {
  let nextPose = Object.fromEntries(Object.entries(pose).map(([name, position]) => [name, [...position]]));
  angleTargets.forEach((target) => {
    const joints = ANGLE_JOINTS[target.body_part];
    const desired = Number(target.target_angle ?? ((Number(target.min) + Number(target.max)) / 2));
    if (!joints || !Number.isFinite(desired)) return;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const current = calculateAngle(nextPose[joints.first], nextPose[joints.center], nextPose[joints.end]);
      if (Math.abs(desired - current) < 1) break;
      const positive = rotateBranch(nextPose, joints.end, joints.center, Math.PI / 180 * 3);
      const negative = rotateBranch(nextPose, joints.end, joints.center, -Math.PI / 180 * 3);
      const positiveError = Math.abs(desired - calculateAngle(positive[joints.first], positive[joints.center], positive[joints.end]));
      const negativeError = Math.abs(desired - calculateAngle(negative[joints.first], negative[joints.center], negative[joints.end]));
      if (positiveError >= Math.abs(desired - current) && negativeError >= Math.abs(desired - current)) break;
      nextPose = positiveError <= negativeError ? positive : negative;
    }
  });
  return groundPose(restorePlantedFootAndResolve(nextPose, pose));
}

function poseFromRanges(rangeTargets = []) {
  return poseFromAngleTargets(freshPose(), rangeTargets);
}

function Bone({ color = "#c9e2ff", emissive = "#17334f", from, to }) {
  const transform = useMemo(() => {
    const start = new THREE.Vector3(...from); const end = new THREE.Vector3(...to); const direction = end.clone().sub(start); const midpoint = start.clone().add(end).multiplyScalar(.5);
    return { midpoint, length: direction.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()) };
  }, [from, to]);
  return <mesh position={transform.midpoint} quaternion={transform.quaternion}><cylinderGeometry args={[.075, .075, transform.length, 12]} /><meshStandardMaterial color={color} emissive={emissive} roughness={.48} /></mesh>;
}

const ComparisonSkeleton = memo(function ComparisonSkeleton({ color, label, offset, opacity = .72, pose }) {
  return <group position={offset}>
    {LINKS.map(([from, to]) => <Bone color={color} emissive="#111820" from={pose[from]} key={`${label}-${from}-${to}`} to={pose[to]} />)}
    {Object.entries(pose).map(([name, position]) => <mesh key={`${label}-${name}`} position={position}><sphereGeometry args={[name === "head" ? .23 : .135, 20, 20]} /><meshStandardMaterial color={color} emissive="#101820" opacity={opacity} transparent /></mesh>)}
    <Html center position={[0, 2.12, 0]}><span className="pose-designer__scene-label">{label}</span></Html>
  </group>;
});

function PoseScene({ pose, poseScale, selectedJoint, transformMode, rotation, rotationSnap, onSelectJoint, onMoveJoint, onRotateJoint }) {
  const studio = useContext(PoseStudioContext);
  const { camera } = useThree();
  const studioOffsets = studio?.singlePoseMode ? TWO_POSE_OFFSETS : STUDIO_OFFSETS;
  const activeOffset = studio ? studioOffsets[studio.activeEndpoint] : STUDIO_OFFSETS.optimal;
  const studioPoseA = studio?.poseA;
  const studioPoseB = studio?.poseB;
  const studioOptimalPose = studio?.optimalPose;
  const poseA = useMemo(() => poseFromReferencePose(studioPoseA) || (studio ? freshPose() : null), [studio, studioPoseA]);
  const poseB = useMemo(() => poseFromReferencePose(studioPoseB) || (studio ? freshPose() : null), [studio, studioPoseB]);
  const optimalPose = useMemo(() => poseFromReferencePose(studioOptimalPose) || (studio ? freshPose() : null), [studio, studioOptimalPose]);
  const transformTarget = useMemo(() => new THREE.Object3D(), []);
  const isTransforming = useRef(false);
  const transformFrame = useRef(null);
  useEffect(() => {
    if (!studio) return;
    camera.position.set(0, 1.15, 9.4);
  }, [camera, studio]);
  useEffect(() => {
    if (isTransforming.current) return;
    transformTarget.position.fromArray(pose[selectedJoint]);
    transformTarget.rotation.set(...rotation);
    transformTarget.updateMatrixWorld();
  }, [pose, rotation, selectedJoint, transformTarget]);
  const chooseJoint = (event, name) => { event.stopPropagation(); onSelectJoint(name); };
  useEffect(() => () => window.cancelAnimationFrame(transformFrame.current), []);
  const applyTransform = () => {
    if (transformMode === "translate") onMoveJoint(selectedJoint, transformTarget.position.toArray());
    else onRotateJoint(selectedJoint, transformTarget.rotation.toArray().slice(0, 3));
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
    if (hasPendingTransform) window.cancelAnimationFrame(transformFrame.current);
    transformFrame.current = null;
    if (hasPendingTransform) applyTransform();
  };
  return <>
    <ambientLight intensity={1.8} /><directionalLight intensity={2.4} position={[3, 5, 4]} />
    <GizmoHelper alignment="bottom-right" margin={[80, 80]}><GizmoViewport axisColors={["#ef5350", "#60d394", "#6aa8ff"]} labelColor="white" /></GizmoHelper>
    {studio?.singlePoseMode ? <>
      <mesh position={[-1.55, FLOOR_Y - .012, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.75, 5.8]} /><meshStandardMaterial color="#11212a" metalness={.08} roughness={.92} /></mesh>
      <Grid args={[2.7, 5.7]} cellColor="#315d67" cellSize={.35} fadeDistance={7} sectionColor="#58c7ad" sectionSize={1.4} position={[-1.55, FLOOR_Y, 0]} />
      <mesh position={[1.55, FLOOR_Y - .012, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.75, 5.8]} /><meshStandardMaterial color="#17202b" metalness={.08} roughness={.92} /></mesh>
      <Grid args={[2.7, 5.7]} cellColor="#3e5268" cellSize={.35} fadeDistance={7} sectionColor="#60d394" sectionSize={1.4} position={[1.55, FLOOR_Y, 0]} />
    </> : <>
      <mesh position={[0, FLOOR_Y - .012, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 8]} /><meshStandardMaterial color="#111c27" metalness={.08} roughness={.92} /></mesh>
      <Grid args={[9, 9]} cellColor="#31506f" cellSize={.5} fadeDistance={9} infiniteGrid sectionColor="#68a8ff" sectionSize={2} position={[0, FLOOR_Y, 0]} />
    </>}
    {studio && !studio.singlePoseMode && studio.activeEndpoint !== "pose_a" ? <ComparisonSkeleton color="#6aa8ff" label="POSE A" offset={STUDIO_OFFSETS.pose_a} pose={poseA} /> : null}
    {studio ? <ComparisonSkeleton color={studio.optimalPose ? "#60d394" : "#68717e"} label={studio.optimalPose ? "OPTIMIZED" : "OPTIMIZED · PENDING"} offset={studioOffsets.optimal} opacity={studio.optimalPose ? .82 : .32} pose={optimalPose} /> : null}
    {studio && !studio.singlePoseMode && studio.activeEndpoint !== "pose_b" ? <ComparisonSkeleton color="#d69bff" label="POSE B" offset={STUDIO_OFFSETS.pose_b} pose={poseB} /> : null}
    <group position={activeOffset} scale={studio ? 1 : poseScale}>
      <primitive object={transformTarget} />
      {LINKS.map(([from, to]) => <Bone from={pose[from]} key={`${from}-${to}`} to={pose[to]} />)}
      {Object.entries(pose).map(([name, position]) => <mesh key={name} onClick={(event) => chooseJoint(event, name)} position={position}><sphereGeometry args={[name === "head" ? .23 : .135, 24, 24]} /><meshStandardMaterial color={selectedJoint === name ? "#60d394" : "#f4f4f4"} emissive={selectedJoint === name ? "#256e4c" : "#111111"} /></mesh>)}
      {studio ? <Html center position={[0, 2.12, 0]}><span className={`pose-designer__scene-label is-${studio.activeEndpoint}`}>{studio.singlePoseMode ? "INITIAL · EDITING" : studio.activeEndpoint === "pose_a" ? "POSE A · EDITING" : "POSE B · EDITING"}</span></Html> : null}
    </group>
    <TransformControls
      mode={transformMode}
      object={transformTarget}
      onMouseDown={() => { isTransforming.current = true; }}
      onMouseUp={finishTransform}
      onObjectChange={handleTransform}
      rotationSnap={rotationSnap ? THREE.MathUtils.degToRad(5) : null}
      size={.85}
      space="world"
    />
    <OrbitControls makeDefault maxDistance={12} minDistance={3} target={[0, 0, 0]} />
  </>;
}

export default function PoseRangeDesigner({
  initialAngleTolerance = 12,
  onApply,
  onPoseChange,
  rangeTargets = [],
  referencePose = null,
  studioActions = null,
  studioLead = null
}) {
  const workbenchRef = useRef(null);
  const studio = useContext(PoseStudioContext);
  const [pose, setPose] = useState(() => groundPose(poseFromReferencePose(referencePose) || (rangeTargets.length ? poseFromRanges(rangeTargets) : freshPose())));
  const [selectedJoint, setSelectedJoint] = useState("elbow_left");
  const [tolerance, setTolerance] = useState(initialAngleTolerance);
  const [positionTolerance, setPositionTolerance] = useState(() => Number(referencePose?.tolerance) || .03);
  const positionToleranceRef = useRef(positionTolerance);
  const [transformMode, setTransformMode] = useState("translate");
  const [rotationSnap, setRotationSnap] = useState(false);
  const [jointRotations, setJointRotations] = useState({});
  const [draftAngleValues, setDraftAngleValues] = useState(() => Object.fromEntries(ANGLES.map(([body_part, , first, center, last]) => [body_part, String(calculateAngle(pose[first], pose[center], pose[last]))])));
  const [activeAngleInput, setActiveAngleInput] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [anglesOpen, setAnglesOpen] = useState(true);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === workbenchRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key.toLowerCase() === "g") setTransformMode("translate");
      if (event.key.toLowerCase() === "r") setTransformMode("rotate");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  const calculated = useMemo(() => ANGLES.map(([body_part, label, first, center, last]) => ({ body_part, label, target_angle: calculateAngle(pose[first], pose[center], pose[last]) })), [pose]);
  const syncAngleDrafts = (nextPose, activeBodyPart = null) => {
    setDraftAngleValues((current) => Object.fromEntries(ANGLES.map(([body_part, , first, center, last]) => {
      const nextValue = String(calculateAngle(nextPose[first], nextPose[center], nextPose[last]));
      if (activeBodyPart && body_part === activeBodyPart) return [body_part, current[body_part] ?? nextValue];
      return [body_part, nextValue];
    })));
  };
  const moveJoint = (name, position) => setPose((current) => {
    const currentPosition = current[name];
    let nextPosition = position;
    const parent = PARENT_JOINTS[name];
    if (parent) {
      const parentPosition = current[parent];
      const direction = position.map((value, index) => value - parentPosition[index]);
      const directionLength = Math.hypot(...direction);
      if (directionLength > .0001) nextPosition = direction.map((value, index) => parentPosition[index] + value / directionLength * BONE_LENGTHS[name]);
    }
    const change = nextPosition.map((value, index) => value - currentPosition[index]);
    const nextPose = { ...current, [name]: nextPosition.map((value) => Number(value.toFixed(3))) };
    const moveChildren = (parentName) => (CHILD_JOINTS[parentName] || []).forEach((child) => {
      nextPose[child] = nextPose[child].map((value, index) => Number((value + change[index]).toFixed(3)));
      moveChildren(child);
    });
    moveChildren(name);
    const nextResolvedPose = groundPose(restorePlantedFootAndResolve(nextPose, current, name));
    syncAngleDrafts(nextResolvedPose, activeAngleInput);
    return nextResolvedPose;
  });
  const updateCoordinate = (index, value) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    const position = [...pose[selectedJoint]];
    position[index] = Math.max(-3, Math.min(3, nextValue));
    moveJoint(selectedJoint, position);
  };
  const rotateJoint = (name, nextRotation) => {
    const normalizedRotation = nextRotation.map((value) => Number.isFinite(value) ? value : 0);
    const previousRotation = jointRotations[name] || [0, 0, 0];
    const previousQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...previousRotation));
    const nextQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...normalizedRotation));
    const deltaQuaternion = nextQuaternion.clone().multiply(previousQuaternion.clone().invert());
    setPose((current) => {
      const nextPose = groundPose(rotateDescendants(current, name, deltaQuaternion));
      syncAngleDrafts(nextPose, activeAngleInput);
      return nextPose;
    });
    setJointRotations((current) => ({ ...current, [name]: normalizedRotation }));
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
    const clampedValue = Math.max(0, Math.min(180, nextValue));
    setPose((current) => {
      const nextPose = poseFromAngleTargets(current, [{ body_part: bodyPart, target_angle: clampedValue }]);
      syncAngleDrafts(nextPose, activeAngleInput);
      return nextPose;
    });
    setJointRotations({});
    setDraftAngleValues((current) => ({ ...current, [bodyPart]: String(clampedValue) }));
  };
  const commitAngleTarget = (bodyPart) => {
    applyAngleTarget(bodyPart, draftAngleValues[bodyPart]);
    setActiveAngleInput(null);
  };
  const apply = () => {
    const safeAngleTolerance = Math.min(30, Math.max(1, tolerance));
    const safePositionTolerance = Math.max(.01, positionTolerance);
    setTolerance(safeAngleTolerance);
    setPositionTolerance(safePositionTolerance);
    onApply(
      calculated.map((item) => ({ ...item, min: Math.max(0, item.target_angle - safeAngleTolerance), max: Math.min(180, item.target_angle + safeAngleTolerance), role: "supporting", weight: 1 })),
      referencePoseFromPose(pose, Math.min(.5, safePositionTolerance)),
      { angle_degrees: safeAngleTolerance, position_normalized: safePositionTolerance }
    );
  };
  useEffect(() => { positionToleranceRef.current = positionTolerance; }, [positionTolerance]);
  useEffect(() => {
    onPoseChange?.(referencePoseFromPose(pose, positionToleranceRef.current));
  }, [onPoseChange, pose]);
  const loadCurrentRanges = () => { const nextPose = groundPose(poseFromReferencePose(referencePose) || poseFromRanges(rangeTargets)); setPose(nextPose); syncAngleDrafts(nextPose); setPositionTolerance(Number(referencePose?.tolerance) || .12); setJointRotations({}); };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workbenchRef.current?.requestFullscreen();
  };
  const selectedRotation = jointRotations[selectedJoint] || [0, 0, 0];
  const resetPose = () => { const nextPose = groundPose(freshPose()); setPose(nextPose); syncAngleDrafts(nextPose); setSelectedJoint("elbow_left"); setJointRotations({}); };
  return <section className="pose-designer pose-designer--workbench" ref={workbenchRef}><div className={`pose-designer__toolbar ${studio ? "is-studio-toolbar" : ""}`}><div>{studioLead || <span className="catalog-admin__eyebrow">Pose workbench</span>}<div className="pose-designer__mode-switch" aria-label="Transform mode"><button className={transformMode === "translate" ? "is-active" : ""} onClick={() => setTransformMode("translate")} title="Move joints (G)" type="button">Move <kbd>G</kbd></button><button className={transformMode === "rotate" ? "is-active" : ""} onClick={() => setTransformMode("rotate")} title="Rotate limbs (R)" type="button">Rotate <kbd>R</kbd></button></div></div><span className="pose-designer__navigation-help">Orbit: drag · Pan: right drag · Zoom: wheel</span><div className="pose-designer__toolbar-actions">{studioActions}<details className="pose-designer__panels-menu"><summary className="btn btn--ghost btn--small">Panels</summary><div><button aria-pressed={inspectorOpen} className={inspectorOpen ? "is-active" : ""} onClick={() => setInspectorOpen((value) => !value)} type="button">Inspector</button><button aria-pressed={anglesOpen} className={anglesOpen ? "is-active" : ""} onClick={() => setAnglesOpen((value) => !value)} type="button">Angles</button></div></details><button className="btn btn--ghost btn--small" onClick={loadCurrentRanges} title="Load saved step pose" type="button">Load</button>{!studio ? <button className="btn btn--ghost btn--small" onClick={toggleFullscreen} type="button">{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button> : null}<button className="btn btn--ghost btn--small" onClick={resetPose} title="Reset current endpoint" type="button">Reset</button></div></div><div className={`pose-designer__workbench ${inspectorOpen ? "" : "is-inspector-collapsed"}`}><div className="pose-designer__viewport"><div className="pose-designer__viewport-bar"><span>Perspective</span><span>Pose collection / {selectedJoint}</span></div><Canvas camera={{ fov: 32, position: [2.8, 1.3, 5.1] }}><color attach="background" args={["#0c121b"]} /><PoseScene onMoveJoint={moveJoint} onRotateJoint={rotateJoint} onSelectJoint={setSelectedJoint} pose={pose} poseScale={1.35} rotation={selectedRotation} rotationSnap={rotationSnap} selectedJoint={selectedJoint} transformMode={transformMode} /></Canvas><div className="pose-designer__canvas-status"><span>Selected: <strong>{selectedJoint.replace("_", " ")}</strong></span><span>{transformMode === "rotate" ? "Drag a colored ring to rotate the limb" : "Drag an axis to position the joint"}</span><span>{Object.keys(pose).length} points · {LINKS.length} fixed bones</span></div></div>{inspectorOpen ? <aside className="pose-designer__inspector"><section><header>Outliner <span>Pose</span></header><div className="pose-designer__joint-list">{Object.keys(pose).map((joint) => <button className={selectedJoint === joint ? "is-selected" : ""} key={joint} onClick={() => setSelectedJoint(joint)} type="button"><i />{joint.replaceAll("_", " ")}</button>)}</div></section><section><header>Transform <span>{transformMode === "translate" ? "Location" : "Rotation"}</span></header>{transformMode === "translate" ? <><div className="pose-designer__rig-lock pose-designer__rig-lock--fixed"><span aria-hidden="true">●</span> All bone lengths fixed</div>{["X", "Y", "Z"].map((axis, index) => <label className={`pose-designer__axis pose-designer__axis--${axis.toLowerCase()}`} key={axis}>{axis}<input onChange={(event) => updateCoordinate(index, event.target.value)} step=".01" type="number" value={pose[selectedJoint][index]} /></label>)}</> : <><label className="pose-designer__rig-lock"><input checked={rotationSnap} onChange={(event) => setRotationSnap(event.target.checked)} type="checkbox" /> Snap to 5°</label>{["X", "Y", "Z"].map((axis, index) => <label className={`pose-designer__axis pose-designer__axis--${axis.toLowerCase()}`} key={axis}>{axis}<span className="pose-designer__degree-input"><input onChange={(event) => updateRotation(index, event.target.value)} step="1" type="number" value={Number(THREE.MathUtils.radToDeg(selectedRotation[index]).toFixed(1))} /><span>°</span></span></label>)}{!(CHILD_JOINTS[selectedJoint] || []).length ? <p className="pose-designer__rotation-hint">This end joint has no downstream limb to rotate.</p> : null}</>}</section></aside> : null}</div>{anglesOpen ? <div className="pose-designer__angles pose-designer__angles--dock"><div className="pose-designer__angles-heading"><label>Angle ±<input max="45" min="1" onChange={(event) => setTolerance(Number(event.target.value))} type="number" value={tolerance} />°</label><label>Position ±<input max=".5" min=".01" onChange={(event) => setPositionTolerance(Number(event.target.value))} step=".01" type="number" value={positionTolerance} /></label><button className="btn btn--light btn--small" onClick={apply} type="button">Apply pose</button></div><div className="pose-designer__angle-list">{calculated.map((item) => <div key={item.body_part}><span>{item.label}</span><label className="pose-designer__angle-input"><input max="180" min="0" onBlur={() => commitAngleTarget(item.body_part)} onChange={(event) => { updateAngleDraft(item.body_part, event.target.value); applyAngleTarget(item.body_part, event.target.value); }} onFocus={() => setActiveAngleInput(item.body_part)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitAngleTarget(item.body_part); } }} step="1" type="number" value={draftAngleValues[item.body_part] ?? ""} /><span>°</span></label></div>)}</div></div> : null}</section>;
}
