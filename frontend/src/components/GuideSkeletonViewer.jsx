import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { interpolateArticulation, interpolatePose, poseFromReferencePose, PoseScene } from "./PoseRangeDesigner";

const DEFAULT_ARTICULATION = { face: { jaw_openness: 0, gaze_horizontal: 0, gaze_vertical: 0 }, hand_left: { fist_closure: 0, finger_spread: 1, palm_turn: 0, wrist_rotation: [0, 0, 0] }, hand_right: { fist_closure: 0, finger_spread: 1, palm_turn: 0, wrist_rotation: [0, 0, 0] } };
function phaseOffset(segments, index) {
  return segments.slice(0, index).reduce((sum, segment) => sum + segment.duration, 0);
}
function formatTime(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function GuideSkeletonViewer({ animation = {}, onPhaseChange = () => {}, selectedPhaseIndex = null, steps = [] }) {
  const frames = useMemo(() => steps
    .map((step, sourceIndex) => ({ ...step, sourceIndex }))
    .filter((step) => step.reference_pose?.landmarks)
    .sort((left, right) => (Number(left.step_number) || 0) - (Number(right.step_number) || 0)), [steps]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(Number(animation.playback_speed) || 0.75);
  const [elapsed, setElapsed] = useState(0);
  const previousTime = useRef(null);
  const poseFrames = useMemo(() => frames.map((frame) => poseFromReferencePose(frame.reference_pose)), [frames]);
  const segments = useMemo(() => frames.map((frame, index) => ({
    duration: Math.max(250, Number(frame.transition_duration_ms) || (index === frames.length - 1 ? 900 : 1000)),
    from: index,
    // The final phase holds its completed pose.  Looping then restarts at
    // frame one, rather than animating backward from the final pose.
    to: index < frames.length - 1 ? index + 1 : index,
  })), [frames]);
  const totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0) || 1;
  const selectedFrameIndex = frames.findIndex((frame) => frame.sourceIndex === selectedPhaseIndex);

  useEffect(() => {
    if (!playing || frames.length < 1) return undefined;
    let requestId;
    const tick = (time) => {
      if (previousTime.current !== null) {
        setElapsed((value) => {
          const next = value + ((time - previousTime.current) * speed);
          return next % totalDuration;
        });
      }
      previousTime.current = time;
      requestId = window.requestAnimationFrame(tick);
    };
    requestId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(requestId);
      previousTime.current = null;
    };
  }, [frames.length, playing, speed, totalDuration]);

  useEffect(() => {
    if (selectedFrameIndex < 0 || !segments[selectedFrameIndex]) return;
    const requestId = window.requestAnimationFrame(() => {
      setElapsed(phaseOffset(segments, selectedFrameIndex));
      setPlaying(false);
    });
    return () => window.cancelAnimationFrame(requestId);
  }, [segments, selectedFrameIndex]);

  const cursor = elapsed % totalDuration;
  let activeIndex = segments.length - 1;
  let localElapsed = segments[activeIndex]?.duration || 0;
  let accumulated = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const end = accumulated + segments[index].duration;
    if (cursor < end || index === segments.length - 1) {
      activeIndex = index;
      localElapsed = cursor - accumulated;
      break;
    }
    accumulated = end;
  }
  const segment = segments[activeIndex];
  const transitionProgress = segment?.to === segment?.from ? 1 : Math.min(1, Math.max(0, localElapsed / segment.duration));
  const activePose = segment && poseFrames[segment.from] && poseFrames[segment.to]
    ? interpolatePose(poseFrames[segment.from], poseFrames[segment.to], transitionProgress)
    : poseFrames[0];
  const guideArticulation = segment
    ? interpolateArticulation(frames[segment.from]?.reference_pose?.articulation, frames[segment.to]?.reference_pose?.articulation, transitionProgress)
    : DEFAULT_ARTICULATION;
  const activeStep = frames[activeIndex];
  const targetStep = frames[segment?.to] || activeStep;
  const progress = Math.min(100, Math.max(0, (cursor / totalDuration) * 100));
  const currentTime = formatTime(cursor);
  const durationTime = formatTime(totalDuration);

  if (!frames.length) return <div className="guide-skeleton guide-skeleton--empty">Add reference poses to preview this technique.</div>;

  const selectPhase = (index) => {
    onPhaseChange(frames[index].sourceIndex);
    setElapsed(phaseOffset(segments, index));
    setPlaying(false);
  };
  const togglePlayback = () => {
    // Every Play starts at step 1, then loops forward through the complete
    // technique. This prevents a paused final step from appearing to start
    // a reverse playback cycle.
    if (playing) {
      setPlaying(false);
      return;
    }
    setElapsed(0);
    setPlaying(true);
  };
  const scrubTo = (value) => {
    const next = (Number(value) / 100) * totalDuration;
    setElapsed(next);
    setPlaying(false);
  };

  const playbackStatus = playing ? "Looping technique" : "Paused";

  return <section className="guide-skeleton guide-skeleton--workbench" aria-label="Read-only animated technique studio">
    <header className="guide-workbench__toolbar"><strong>POSE WORKBENCH</strong><span className="guide-workbench__hint">Read-only guide studio · Orbit: drag · Zoom: wheel</span><span aria-live="polite" className="guide-workbench__state">{playbackStatus}</span></header>
    <div className="guide-workbench__viewport"><span className="guide-workbench__perspective">Perspective</span><span className="guide-workbench__collection">Read-only pose reference</span><Canvas camera={{ fov: 32, position: [2.8, 1.3, 5.1] }} dpr={[1, 1.5]} gl={{ antialias: true }}><color attach="background" args={["#080e17"]} /><gridHelper args={[8, 20, "#17374d", "#0b1c29"]} position={[0, -1.66, 0]} /><PoseScene articulation={guideArticulation} animationProgress={transitionProgress} cameraViewRef={null} editingEnabled={false} guidesVisible={false} onMoveJoint={() => {}} onRotateJoint={() => {}} onSelectJoint={() => {}} pose={activePose} poseScale={1.35} rotation={[0, 0, 0]} rotationSnap={false} selectedJoint={null} strikingSide={activeStep?.striking_side || ""} strikingSurface={activeStep?.striking_surface || ""} targetStrikingSide={targetStep?.striking_side || ""} targetStrikingSurface={targetStep?.striking_surface || ""} transformMode="translate" /><OrbitControls enablePan={false} maxDistance={16} minDistance={3.2} target={[0, -0.1, 0]} /></Canvas><span className="guide-skeleton__phase">{activeStep?.step_name || "Reference pose"}</span><span className="guide-workbench__status">Read-only reference <em>·</em> {Object.keys(activePose || {}).length} fixed points</span></div>
    <footer className="guide-workbench__timeline">
      <div className="guide-workbench__timeline-head">
        <div><strong>Technique timeline</strong><small>Choose a step to inspect it, or drag the playhead to any moment.</small></div>
        <div className="guide-workbench__timeline-actions">
          <div className="guide-workbench__transport" role="group" aria-label="Timeline navigation">
            <button aria-label={playing ? "Pause animation" : "Play animation"} className="guide-workbench__play" onClick={togglePlayback} type="button">{playing ? "Pause" : "Play"}</button>
          </div>
          <label className="guide-workbench__speed"><span>Speed</span><select aria-label="Playback speed" onChange={(event) => setSpeed(Number(event.target.value))} value={speed}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
        </div>
      </div>
      <div className="guide-workbench__phase-track">{segments.map((item, index) => <button aria-current={index === activeIndex ? "step" : undefined} className={index === activeIndex ? "is-active" : ""} key={`${frames[index].step_number}-${frames[index].step_name}`} onClick={() => selectPhase(index)} style={{ flex: `${item.duration} 1 0` }} type="button"><span className="guide-workbench__phase-dot">{String(index + 1).padStart(2, "0")}</span><strong>{frames[index].step_name}</strong><small>{(item.duration / 1000).toFixed(2)}s</small></button>) }<span className="guide-workbench__phase-progress" style={{ width: `${progress}%` }} /></div>
      <div className="guide-workbench__scrubber"><output>{currentTime} / {durationTime}</output><input aria-label="Animation timeline position" max="100" min="0" onChange={(event) => scrubTo(event.target.value)} step="0.1" type="range" value={progress} /><small>{activeStep?.step_name || "Reference pose"} · {Math.round(transitionProgress * 100)}% complete</small></div>
    </footer>
  </section>;
}
