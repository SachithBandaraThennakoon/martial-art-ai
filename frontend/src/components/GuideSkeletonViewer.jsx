import { Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import GuideGlbSkeleton from "./GuideGlbSkeleton";
import { interpolateGuideArticulation, interpolateGuideLandmarks } from "../utils/guideSkeletonAnimation";

const PRIMARY = "#bcefff";
const SECONDARY = "#287ea6";
const HEAD = "#b798ff";
const ACTIVE = "#f4c95d";

const FALLBACK_BONES = [
  ["shoulder_left", "shoulder_right"],
  ["shoulder_left", "elbow_left"], ["elbow_left", "wrist_left"],
  ["shoulder_right", "elbow_right"], ["elbow_right", "wrist_right"],
  ["hip_left", "hip_right"], ["hip_left", "knee_left"],
  ["knee_left", "ankle_left"], ["ankle_left", "foot_left"],
  ["hip_right", "knee_right"], ["knee_right", "ankle_right"],
  ["ankle_right", "foot_right"],
];

const CAMERA_POSITIONS = {
  front: [0, 0.2, 7.2],
  side: [7.2, 0.2, 0],
  front_diagonal: [4.8, 0.55, 6.1],
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17], [5, 17],
];

const FOOT_CONNECTIONS = [
  [0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6],
  [5, 6], [5, 7], [6, 8], [7, 8], [7, 9], [8, 9], [3, 4],
];

const vector = (point) => new THREE.Vector3(...point);
const midpoint = (first, second, amount = 0.5) => vector(first).lerp(vector(second), amount).toArray();

function WireLine({ color, from, opacity = 1, primary = false, to }) {
  return <Line color={color} depthTest lineWidth={primary ? 2.35 : 1} opacity={opacity} points={[from, to]} transparent={opacity < 1} />;
}

function Node({ active = false, color = PRIMARY, major = false, position, small = false }) {
  const radius = active ? 0.05 : major ? 0.036 : small ? 0.012 : 0.021;
  return <mesh position={position} renderOrder={3}>
    <sphereGeometry args={[radius, 10, 8]} />
    <meshBasicMaterial color={active ? ACTIVE : color} toneMapped={false} />
  </mesh>;
}

function Network({ color = SECONDARY, connections, nodes, opacity = 0.62, pointColor, primary = false }) {
  return <group>
    {connections.map(([from, to], index) => nodes[from] && nodes[to] ? <WireLine
      color={color} from={nodes[from]} key={`${from}-${to}-${index}`} opacity={opacity} primary={primary} to={nodes[to]}
    /> : null)}
    {nodes.map((point, index) => <Node color={pointColor || color} key={index} position={point} small />)}
  </group>;
}

function bodyBasis(landmarks) {
  const left = vector(landmarks.shoulder_left);
  const right = vector(landmarks.shoulder_right);
  const shoulderCenter = left.clone().add(right).multiplyScalar(0.5);
  const hipCenter = vector(landmarks.hip_left).add(vector(landmarks.hip_right)).multiplyScalar(0.5);
  const across = right.clone().sub(left).normalize();
  const up = shoulderCenter.clone().sub(hipCenter).normalize();
  const forward = across.clone().cross(up).normalize();
  if (forward.z < 0) forward.negate();
  return { across, forward, shoulderCenter, up };
}

function SegmentCage({ end, endRadius, start, startRadius }) {
  const nodes = useMemo(() => {
    const first = vector(start);
    const last = vector(end);
    const direction = last.clone().sub(first).normalize();
    const reference = Math.abs(direction.dot(new THREE.Vector3(0, 0, 1))) > 0.88
      ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const side = direction.clone().cross(reference).normalize();
    const depth = side.clone().cross(direction).normalize();
    const ring = (center, radius) => [
      center.clone().addScaledVector(side, radius).toArray(),
      center.clone().addScaledVector(depth, radius * 0.82).toArray(),
      center.clone().addScaledVector(side, -radius).toArray(),
      center.clone().addScaledVector(depth, -radius * 0.82).toArray(),
    ];
    return [...ring(first, startRadius), ...ring(last, endRadius)];
  }, [end, endRadius, start, startRadius]);
  const connections = useMemo(() => [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7], [0, 5], [2, 7],
  ], []);
  return <Network connections={connections} nodes={nodes} />;
}

function HeadCage({ basis, position }) {
  const { connections, nodes } = useMemo(() => {
    const center = vector(position);
    const rings = [
      { y: 0.19, width: 0.075, depth: 0.08 }, { y: 0.095, width: 0.145, depth: 0.13 },
      { y: 0, width: 0.155, depth: 0.145 }, { y: -0.095, width: 0.125, depth: 0.12 },
      { y: -0.175, width: 0.055, depth: 0.06 },
    ];
    const points = [];
    rings.forEach((ring) => {
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        points.push(center.clone().addScaledVector(basis.up, ring.y)
          .addScaledVector(basis.across, Math.cos(angle) * ring.width)
          .addScaledVector(basis.forward, Math.sin(angle) * ring.depth).toArray());
      }
    });
    const links = [];
    rings.forEach((_, ringIndex) => {
      for (let index = 0; index < 6; index += 1) {
        links.push([(ringIndex * 6) + index, (ringIndex * 6) + ((index + 1) % 6)]);
        if (ringIndex < rings.length - 1) links.push([(ringIndex * 6) + index, ((ringIndex + 1) * 6) + index]);
      }
    });
    return { connections: links, nodes: points };
  }, [basis, position]);
  return <Network color={HEAD} connections={connections} nodes={nodes} opacity={0.76} pointColor="#e4d9ff" />;
}

function TorsoCage({ basis, landmarks }) {
  const { connections, nodes, spine } = useMemo(() => {
    const leftShoulder = vector(landmarks.shoulder_left);
    const rightShoulder = vector(landmarks.shoulder_right);
    const leftHip = vector(landmarks.hip_left);
    const rightHip = vector(landmarks.hip_right);
    const sections = [
      { left: leftShoulder, right: rightShoulder, depth: 0.14 },
      { left: leftShoulder.clone().lerp(leftHip, 0.34).addScaledVector(basis.across, 0.06), right: rightShoulder.clone().lerp(rightHip, 0.34).addScaledVector(basis.across, -0.06), depth: 0.17 },
      { left: leftShoulder.clone().lerp(leftHip, 0.68).addScaledVector(basis.across, 0.08), right: rightShoulder.clone().lerp(rightHip, 0.68).addScaledVector(basis.across, -0.08), depth: 0.13 },
      { left: leftHip, right: rightHip, depth: 0.12 },
    ];
    const points = [];
    const centers = [];
    sections.forEach(({ left, right, depth }) => {
      centers.push(left.clone().add(right).multiplyScalar(0.5).toArray());
      points.push(left.clone().addScaledVector(basis.forward, depth).toArray(), right.clone().addScaledVector(basis.forward, depth).toArray(),
        left.clone().addScaledVector(basis.forward, -depth).toArray(), right.clone().addScaledVector(basis.forward, -depth).toArray());
    });
    const links = [];
    sections.forEach((_, section) => {
      const offset = section * 4;
      links.push([offset, offset + 1], [offset + 1, offset + 3], [offset + 3, offset + 2], [offset + 2, offset]);
      if (section < sections.length - 1) {
        for (let corner = 0; corner < 4; corner += 1) links.push([offset + corner, offset + 4 + corner]);
        links.push([offset, offset + 5], [offset + 1, offset + 4]);
      }
    });
    return { connections: links, nodes: points, spine: centers };
  }, [basis, landmarks]);
  return <group>
    <Network connections={connections} nodes={nodes} />
    <Network color="#75ddec" connections={[[0, 1], [1, 2], [2, 3]]} nodes={spine} opacity={0.95} pointColor={PRIMARY} primary />
  </group>;
}

function PelvisCage({ basis, landmarks }) {
  const { connections, nodes } = useMemo(() => {
    const left = vector(landmarks.hip_left);
    const right = vector(landmarks.hip_right);
    const center = left.clone().add(right).multiplyScalar(0.5);
    const lower = center.clone().addScaledVector(basis.up, -0.16);
    const depth = 0.14;
    return {
      nodes: [left.clone().addScaledVector(basis.forward, depth).toArray(), right.clone().addScaledVector(basis.forward, depth).toArray(),
        left.clone().addScaledVector(basis.forward, -depth).toArray(), right.clone().addScaledVector(basis.forward, -depth).toArray(),
        lower.clone().addScaledVector(basis.forward, depth * 0.65).toArray(), lower.clone().addScaledVector(basis.forward, -depth * 0.65).toArray(), center.toArray()],
      connections: [[0, 1], [1, 3], [3, 2], [2, 0], [0, 4], [1, 4], [2, 5], [3, 5], [4, 5], [0, 6], [1, 6], [4, 6]],
    };
  }, [basis, landmarks]);
  return <Network connections={connections} nodes={nodes} opacity={0.72} />;
}

function HandCage({ articulation = {}, elbow, highlighted, side, wrist }) {
  const rotation = useMemo(() => {
    const wristPoint = vector(wrist);
    const direction = wristPoint.clone().sub(vector(elbow)).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  }, [elbow, wrist]);
  const closure = Math.max(0, Math.min(1, Number(articulation.fist_closure) || 0));
  const spread = Math.max(0, Math.min(1, Number(articulation.finger_spread) || 0));
  const palmTurn = (Number(articulation.palm_turn) || 0) * Math.PI * 0.5;
  const nodes = useMemo(() => {
    const points = [[0, 0, 0]];
    const sideSign = side === "left" ? -1 : 1;
    points.push([sideSign * 0.052, 0.045, 0.018], [sideSign * 0.083, 0.072, 0.025],
      [sideSign * 0.102, 0.1, 0.03], [sideSign * 0.112, 0.126, 0.026 + (closure * 0.025)]);
    const bases = [-0.055, -0.018, 0.018, 0.052];
    const lengths = [0.135, 0.15, 0.14, 0.115];
    bases.forEach((baseX, finger) => {
      for (let joint = 0; joint < 4; joint += 1) {
        const progress = joint / 3;
        const curlAngle = closure * progress * Math.PI * 0.9;
        points.push([baseX + (baseX * spread * progress * 0.45),
          0.085 + (Math.sin(Math.min(curlAngle, Math.PI * 0.52)) * lengths[finger] * (1 - (closure * 0.15))),
          0.012 + ((1 - Math.cos(curlAngle)) * 0.07)]);
      }
    });
    const roll = palmTurn * (side === "left" ? 1 : -1);
    const wristPoint = vector(wrist);
    return points.map((point) => vector(point).multiplyScalar(0.58)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), roll)
      .applyQuaternion(rotation)
      .add(wristPoint)
      .toArray());
  }, [closure, palmTurn, rotation, side, spread, wrist]);
  return <group>
    <Network color={highlighted ? ACTIVE : "#8eeaff"} connections={HAND_CONNECTIONS} nodes={nodes} opacity={0.98} pointColor={highlighted ? ACTIVE : PRIMARY} primary />
    <Network connections={[[0, 1], [0, 5], [1, 5], [1, 17], [5, 17], [0, 17]]} nodes={nodes} opacity={0.48} />
  </group>;
}

function FootCage({ ankle, foot }) {
  const { position, rotation } = useMemo(() => {
    const anklePoint = vector(ankle);
    const direction = vector(foot).sub(anklePoint).normalize();
    return { position: anklePoint.toArray(), rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction) };
  }, [ankle, foot]);
  const nodes = useMemo(() => [[0, 0, 0], [-0.065, -0.045, -0.025], [0.065, -0.045, -0.025],
    [-0.075, 0.1, 0.04], [0.075, 0.1, 0.04], [-0.09, 0.22, 0.015],
    [0.09, 0.22, 0.015], [-0.075, 0.29, -0.025], [0.075, 0.29, -0.025], [0, 0.32, -0.035]], []);
  return <group position={position} quaternion={rotation}>
    <Network color="#55d7e8" connections={FOOT_CONNECTIONS} nodes={nodes} opacity={0.86} pointColor={PRIMARY} />
  </group>;
}

function SkeletonFigure({ articulation, bones, highlights, landmarks, trajectory }) {
  const basis = useMemo(() => bodyBasis(landmarks), [landmarks]);
  const shoulderCenter = midpoint(landmarks.shoulder_left, landmarks.shoulder_right);
  const neckTop = vector(landmarks.head).addScaledVector(basis.up, -0.18).toArray();
  const majorJoints = new Set(["shoulder_left", "shoulder_right", "elbow_left", "elbow_right", "wrist_left", "wrist_right", "hip_left", "hip_right", "knee_left", "knee_right", "ankle_left", "ankle_right"]);
  const cages = [
    ["shoulder_left", "elbow_left", 0.085, 0.07], ["elbow_left", "wrist_left", 0.07, 0.048],
    ["shoulder_right", "elbow_right", 0.085, 0.07], ["elbow_right", "wrist_right", 0.07, 0.048],
    ["hip_left", "knee_left", 0.115, 0.085], ["knee_left", "ankle_left", 0.085, 0.055],
    ["hip_right", "knee_right", 0.115, 0.085], ["knee_right", "ankle_right", 0.085, 0.055],
  ];
  return <group>
    <HeadCage basis={basis} position={landmarks.head} />
    <SegmentCage end={shoulderCenter} endRadius={0.1} start={neckTop} startRadius={0.075} />
    <TorsoCage basis={basis} landmarks={landmarks} />
    <PelvisCage basis={basis} landmarks={landmarks} />
    {cages.map(([from, to, startRadius, endRadius]) => <SegmentCage end={landmarks[to]} endRadius={endRadius} key={`${from}-${to}`} start={landmarks[from]} startRadius={startRadius} />)}
    {bones.filter(([from, to]) => !(from === "head" || to === "head")).map(([from, to]) => landmarks[from] && landmarks[to] ? <WireLine
      color={highlights.has(from) || highlights.has(to) ? ACTIVE : PRIMARY} from={landmarks[from]} key={`${from}-${to}`} primary to={landmarks[to]}
    /> : null)}
    <WireLine color={PRIMARY} from={neckTop} primary to={shoulderCenter} />
    {Object.entries(landmarks).filter(([name]) => !["head", "foot_left", "foot_right"].includes(name)).map(([name, point]) => <Node
      active={highlights.has(name)} color={PRIMARY} key={name} major={majorJoints.has(name)} position={point}
    />)}
    <HandCage articulation={articulation.hand_left} elbow={landmarks.elbow_left} highlighted={highlights.has("wrist_left")} side="left" wrist={landmarks.wrist_left} />
    <HandCage articulation={articulation.hand_right} elbow={landmarks.elbow_right} highlighted={highlights.has("wrist_right")} side="right" wrist={landmarks.wrist_right} />
    <FootCage ankle={landmarks.ankle_left} foot={landmarks.foot_left} />
    <FootCage ankle={landmarks.ankle_right} foot={landmarks.foot_right} />
    {trajectory.length > 1 ? <Line color={ACTIVE} dashed dashScale={12} lineWidth={2} opacity={0.72} points={trajectory} transparent /> : null}
  </group>;
}

export default function GuideSkeletonViewer({ animation = {}, steps = [] }) {
  const frames = useMemo(() => steps.filter((step) => step.reference_pose?.landmarks), [steps]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(Number(animation.playback_speed) || 0.75);
  const [elapsed, setElapsed] = useState(0);
  const previousTime = useRef(null);

  useEffect(() => {
    if (!playing || frames.length < 2) return undefined;
    let requestId;
    const tick = (time) => {
      if (previousTime.current !== null) setElapsed((value) => value + ((time - previousTime.current) * speed));
      previousTime.current = time;
      requestId = window.requestAnimationFrame(tick);
    };
    requestId = window.requestAnimationFrame(tick);
    return () => { window.cancelAnimationFrame(requestId); previousTime.current = null; };
  }, [frames.length, playing, speed]);

  const segments = useMemo(() => frames.map((frame, index) => ({
    duration: Number(frame.transition_duration_ms) || (index === frames.length - 1 ? 900 : 1000),
    from: frame,
    to: frames[(index + 1) % frames.length],
  })), [frames]);
  const totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0) || 1;
  let cursor = elapsed % totalDuration;
  let activeIndex = 0;
  while (activeIndex < segments.length - 1 && cursor >= segments[activeIndex].duration) { cursor -= segments[activeIndex].duration; activeIndex += 1; }
  const segment = segments[activeIndex];
  const landmarks = segment ? interpolateGuideLandmarks(segment.from.reference_pose.landmarks, segment.to.reference_pose.landmarks, cursor / segment.duration) : {};
  const articulation = segment ? interpolateGuideArticulation(segment.from.reference_pose.articulation || {}, segment.to.reference_pose.articulation || {}, cursor / segment.duration) : {};
  const sourceBones = frames[0]?.reference_pose?.bones;
  const bones = sourceBones?.length ? sourceBones.map((bone) => [bone.from, bone.to]) : FALLBACK_BONES;
  const highlights = new Set(animation.highlight_joints || []);
  const leadWrist = animation.highlight_joints?.find((joint) => joint.startsWith("wrist_")) || "wrist_left";
  const trajectory = animation.show_trajectory ? frames.map((frame) => frame.reference_pose.landmarks[leadWrist]).filter(Boolean) : [];
  const cameraPosition = CAMERA_POSITIONS[animation.camera_preset] || CAMERA_POSITIONS.front_diagonal;

  if (!frames.length) return <div className="guide-skeleton guide-skeleton--empty">Add reference poses to preview this technique.</div>;
  return <section className="guide-skeleton" aria-label="Animated technique skeleton">
    <div className="guide-skeleton__stage">
      <Canvas camera={{ fov: 28, position: cameraPosition }} dpr={[1, 1.5]} gl={{ antialias: true }}>
        <color attach="background" args={["#03080e"]} />
        <gridHelper args={[8, 20, "#17374d", "#0b1c29"]} position={[0, -1.66, 0]} />
        <Suspense fallback={<SkeletonFigure articulation={articulation} bones={bones} highlights={highlights} landmarks={landmarks} trajectory={trajectory} />}>
          <GuideGlbSkeleton highlights={highlights} landmarks={landmarks} trajectory={trajectory} />
        </Suspense>
        <OrbitControls enablePan={false} maxDistance={10} minDistance={4.5} target={[0, -0.1, 0]} />
      </Canvas>
      <span className="guide-skeleton__phase">{frames[activeIndex]?.step_name || "Reference pose"}</span>
    </div>
    <div className="guide-skeleton__controls">
      <button className="btn btn--ghost btn--small" onClick={() => setPlaying((value) => !value)} type="button">{playing ? "Pause" : "Play"}</button>
      <button className="btn btn--ghost btn--small" onClick={() => setElapsed(0)} type="button">Restart</button>
      <label><span>Speed</span><select onChange={(event) => setSpeed(Number(event.target.value))} value={speed}>
        <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.5">1.5×</option>
      </select></label>
      <small>Drag to rotate · scroll to zoom</small>
    </div>
  </section>;
}
