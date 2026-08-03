import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import AdminPracticeDiagnostics from "../components/AdminPracticeDiagnostics";
import DataLayersPanel from "../components/DataLayersPanel";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import {
  getTechniqueFromCatalog,
  getTechniqueTrackingPackage
} from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";
import { authFetch, getAccessToken } from "../services/authSession";
import {
  createBrowserAudio,
  playBrowserAudio,
  prepareBrowserSpeech
} from "../services/browserVoice";
import {
  buildPracticeSetMessage,
  getPracticeFeedbackIntent
} from "../services/feedbackReasoning";
import {
  attachCountAttention,
  createPracticeMovementClassifier,
  filterPracticeTapeFrames,
  getPracticeCuePrompt,
  reclassifyPracticeSequence,
  shouldProcessPracticeFrame,
  trimPracticeTapeFrames
} from "../utils/practiceMovementClassifier";
import { scorePracticeAngles } from "../utils/practiceAngleScoring";
import {
  attachRuleEngineAnalysisToTape,
  reanalyzePracticeTapeWithRuleEngine
} from "../tracking/practiceTapeRuleEngineBridge";
import {
  buildPracticeSessionAnalysis,
  buildPracticeSessionMetrics,
  selectPracticeTimelineView
} from "../utils/practiceSessionAnalysis";
import {
  selectLatestPracticeSession,
  sortPracticeSessions
} from "../utils/practiceSessionSelectors";

const COUNT_OPTIONS = [3, 5, 10];
const GAP_OPTIONS = [
  { label: "1.5s", value: 1500 },
  { label: "2s", value: 2000 },
  { label: "3s", value: 3000 }
];
const CLEAN_ACCURACY = 80;
const PRACTICE_PRE_ROLL_MS = 600;
const PRACTICE_POST_ROLL_MS = 700;
const PRACTICE_FINAL_ANALYSIS_GRACE_MS = 4000;
const LOCAL_SESSION = { id: null, status: "active" };
const PRACTICE_VOICE_GENDER = "male";
const TAPE_CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
];
const TAPE_HIGHLIGHT_JOINTS = {
  shoulder_left: [11, 13],
  shoulder_right: [12, 14],
  elbow_left: [11, 13, 15],
  elbow_right: [12, 14, 16],
  wrist_left: [13, 15],
  wrist_right: [14, 16],
  fist_left: [13, 15, 17, 19, 21],
  fist_right: [14, 16, 18, 20, 22],
  hand_left_open: [13, 15, 17, 19, 21],
  hand_right_open: [14, 16, 18, 20, 22],
  hip_left: [11, 23, 25],
  hip_right: [12, 24, 26],
  knee_left: [23, 25, 27],
  knee_right: [24, 26, 28],
  eyes_forward: [0, 1, 2, 3, 4, 5, 6],
  face_forward: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  face_calm: [0, 1, 2, 3, 4, 5, 6, 9, 10]
};
const TAPE_VISIBLE_JOINTS = [
  0, 11, 12, 13, 14, 15, 16,
  23, 24, 25, 26, 27, 28
];
const TAPE_HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const TAPE_FACE_CONTOURS = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152],
  [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
];
const TAPE_POSE_FACE_CONNECTIONS = [
  [7, 3], [3, 2], [2, 1], [1, 0], [0, 4], [4, 5], [5, 6], [6, 8],
  [7, 9], [9, 10], [10, 8], [0, 9], [0, 10]
];
const TAPE_FACE_INDICES = new Set(TAPE_FACE_CONTOURS.flat());
const MOTION_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const formatTapeTime = (milliseconds = 0) => {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
};

const formatCountGap = (milliseconds = 0) => {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
};

function StepEvidenceGuide({ step }) {
  const profile = step?.evaluation_profile;
  if (!profile) return null;

  const groups = [
    ["Main angles", profile.main_angles],
    ["Motion / guard", profile.non_angle_features],
    ["Full-body support", profile.full_body_support],
    [
      "Measured body angles",
      (profile.full_body_angles || []).map((angle) => ({
        feature: angle.body_part,
        label: angle.body_part
          .split("_")
          .reverse()
          .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
          .join(" "),
        target: `Ideal ${angle.target_angle ?? Math.round((angle.min + angle.max) / 2)}° · ${angle.min}-${angle.max}°`
      }))
    ]
  ];

  return (
    <details className="panel-block practice-step-evidence">
      <summary>
        <span>
          <small>Current step evidence</small>
          <strong>Step {step.step_number}: {step.step_name}</strong>
        </span>
        <span>{(profile.phase_states || []).join(" → ")}</span>
      </summary>
      <div className="practice-step-evidence__groups">
        {groups.map(([title, items]) => (
          <section key={title}>
            <h3>{title}</h3>
            <ul>
              {(items || []).map((item) => (
                <li key={item.feature}>
                  <span>{item.label}</span>
                  {item.target ? <small>{item.target}</small> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p>
        Lead-arm evidence identifies the phase. Full-body evidence improves coaching confidence;
        missing legs do not reject the Jab.
      </p>
    </details>
  );
}

const formatAttentionOffset = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "No response";
  if (Math.abs(milliseconds) < 50) return "On count";
  return `${milliseconds > 0 ? "+" : "−"}${Math.abs(milliseconds)} ms`;
};

const formatTemporalPhase = (phase) =>
  String(phase || "between_steps")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const buildThirtyFpsTape = (sourceFrames, durationMs) => {
  if (!sourceFrames.length || durationMs <= 0) return [];

  const frameCount = Math.max(1, Math.round((durationMs / 1000) * 30));
  let sourceIndex = 0;

  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const elapsedMs = (frameIndex / 30) * 1000;
    while (
      sourceIndex + 1 < sourceFrames.length &&
      sourceFrames[sourceIndex + 1].elapsedMs <= elapsedMs
    ) {
      sourceIndex += 1;
    }
    return {
      ...sourceFrames[sourceIndex],
      elapsedMs,
      frame: frameIndex + 1
    };
  });
};

const quantizeCoordinate = (value) =>
  Number.isFinite(value) ? Math.round(value * 10000) : null;

const restoreCoordinate = (value) =>
  Number.isFinite(value) ? value / 10000 : null;

const encodePoseLandmarks = (landmarks = []) =>
  landmarks.map((point) => [
    quantizeCoordinate(point?.x),
    quantizeCoordinate(point?.y),
    quantizeCoordinate(point?.z),
    quantizeCoordinate(point?.visibility ?? point?.presence ?? 1)
  ]);

const decodePoseLandmarks = (landmarks = []) =>
  landmarks.map(([x, y, z, visibility]) => ({
    x: restoreCoordinate(x),
    y: restoreCoordinate(y),
    z: restoreCoordinate(z),
    visibility: Number.isFinite(visibility)
      ? restoreCoordinate(visibility)
      : 1
  }));

const encodePracticeTapeFrame = (frame) => ({
  t: Math.round(frame.elapsedMs || 0),
  st: Math.round(frame.sourceTimestampMs || 0),
  n: frame.frame,
  r: frame.rep,
  s: frame.step,
  a: frame.accuracy,
  f: frame.focusBodyPart || null,
  i: frame.issue || null,
  w: frame.wrongBodyParts || [],
  p: encodePoseLandmarks(frame.landmarks),
  op: encodePoseLandmarks(frame.observedLandmarks),
  wp: encodePoseLandmarks(frame.measurementLandmarks),
  ap: encodePoseLandmarks(frame.aggregateLandmarks),
  av: Object.fromEntries(
    Object.entries(frame.angles || {})
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => [name, Math.round(value * 100)])
  ),
  ss: (frame.stepScores || []).map((score) => Math.round(score)),
  tc: Number.isFinite(frame.trackingConfidence)
    ? Math.round(frame.trackingConfidence * 1000)
    : null,
  ds: frame.displayPoseSource || null,
  face: (frame.facePoints || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  fs: frame.faceSource || "pose33",
  hl: (frame.handPoints?.left || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  hr: (frame.handPoints?.right || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  cq: frame.countCue,
  ct: frame.countTimestampMs,
  ao: frame.attentionOffsetMs,
  at: frame.attentionTiming,
  mp: frame.movementPeakMs,
  ph: frame.phase,
  tp: frame.temporalPhase,
  cf: frame.stateConfidence,
  tr: frame.trackingReliable,
  pc: frame.predictionSourceCounts
    ? [
        frame.predictionSourceCounts.observed || 0,
        frame.predictionSourceCounts.level1 || 0,
        frame.predictionSourceCounts.level2 || 0
      ]
    : null,
  pe: frame.predictionAgreementError,
  pf: frame.usedPredictionFallback,
  pcf: frame.predictionConfidence,
  fa: frame.forecastAwareness
    ? [
        frame.forecastAwareness.status || null,
        frame.forecastAwareness.trusted === true,
        frame.forecastAwareness.risk ?? null,
        frame.forecastAwareness.likely_mistake?.body_part || null,
        frame.forecastAwareness.likely_mistake?.issue || null,
        frame.forecastAwareness.likely_mistake?.first_risk_ms ?? null,
        frame.forecastAwareness.horizon_ms ?? null
      ]
    : null,
  lr: frame.liveRep,
  ls: frame.liveStep,
  lph: frame.livePhase,
  ltp: frame.liveTemporalPhase,
  es: frame.expectedStep,
  ms: frame.matchedStep,
  mk: frame.matchKind,
  nr: frame.countedRep,
  dr: frame.completedRep,
  qs: frame.sequenceState,
  ps: frame.postSessionClassified,
  sc: frame.scorable,
  rc: frame.ruleEngineAnalysis?.corrected
    ? {
        r: frame.ruleEngineAnalysis.corrected.rep_id ?? null,
        rs: frame.ruleEngineAnalysis.corrected.rep_state ?? null,
        s: frame.ruleEngineAnalysis.corrected.step ?? null,
        p: frame.ruleEngineAnalysis.corrected.phase ?? null,
        c: frame.ruleEngineAnalysis.corrected.confidence ?? null,
        tl: frame.ruleEngineAnalysis.corrected.tracking_lost === true,
        u: frame.ruleEngineAnalysis.corrected.unknown_movement === true
      }
    : null
});

const decodePracticeTapeFrame = (frame, index) => ({
  elapsedMs: frame.t || 0,
  sourceTimestampMs: frame.st ?? null,
  frame: frame.n || index + 1,
  rep: frame.r || 1,
  step: frame.s || 1,
  accuracy: frame.a ?? null,
  focusBodyPart: frame.f || null,
  issue: frame.i || null,
  wrongBodyParts: frame.w || [],
  landmarks: decodePoseLandmarks(frame.p),
  observedLandmarks: decodePoseLandmarks(frame.op),
  measurementLandmarks: decodePoseLandmarks(frame.wp),
  aggregateLandmarks: decodePoseLandmarks(frame.ap),
  angles: Object.fromEntries(
    Object.entries(frame.av || {}).map(([name, value]) => [
      name,
      Number.isFinite(value) ? value / 100 : null
    ])
  ),
  stepScores: frame.ss || [],
  trackingConfidence: Number.isFinite(frame.tc) ? frame.tc / 1000 : null,
  displayPoseSource: frame.ds || "observed",
  facePoints: (frame.face || []).map(([pointIndex, x, y]) => ({
    index: pointIndex,
    x: restoreCoordinate(x),
    y: restoreCoordinate(y)
  })),
  faceSource: frame.fs || "pose33",
  handPoints: {
    left: (frame.hl || []).map(([pointIndex, x, y]) => ({
      index: pointIndex,
      x: restoreCoordinate(x),
      y: restoreCoordinate(y)
    })),
    right: (frame.hr || []).map(([pointIndex, x, y]) => ({
      index: pointIndex,
      x: restoreCoordinate(x),
      y: restoreCoordinate(y)
    }))
  },
  countCue: frame.cq ?? null,
  countTimestampMs: frame.ct ?? null,
  attentionOffsetMs: frame.ao ?? null,
  attentionTiming: frame.at || "no-response",
  movementPeakMs: frame.mp ?? null,
  phase: frame.ph || "keyframe",
  temporalPhase: frame.tp || (frame.ph === "keyframe" ? "step_hold" : "between_steps"),
  stateConfidence: frame.cf ?? null,
  trackingReliable: frame.tr !== false,
  predictionSourceCounts: frame.pc
    ? {
        observed: frame.pc[0] || 0,
        level1: frame.pc[1] || 0,
        level2: frame.pc[2] || 0,
        total: (frame.pc[0] || 0) + (frame.pc[1] || 0) + (frame.pc[2] || 0)
      }
    : null,
  predictionAgreementError: frame.pe ?? null,
  usedPredictionFallback: frame.pf === true,
  predictionConfidence: frame.pcf ?? null,
  forecastAwareness: frame.fa
    ? {
        status: frame.fa[0] || "unavailable",
        trusted: frame.fa[1] === true,
        risk: frame.fa[2] ?? 0,
        likely_mistake: frame.fa[3]
          ? {
              body_part: frame.fa[3],
              issue: frame.fa[4] || null,
              first_risk_ms: frame.fa[5] ?? null
            }
          : null,
        horizon_ms: frame.fa[6] ?? null
      }
    : null,
  liveRep: frame.lr ?? null,
  liveStep: frame.ls ?? null,
  livePhase: frame.lph || null,
  liveTemporalPhase: frame.ltp || null,
  expectedStep: frame.es ?? null,
  matchedStep: frame.ms ?? null,
  matchKind: frame.mk || null,
  countedRep: frame.nr ?? null,
  completedRep: frame.dr ?? null,
  sequenceState: frame.qs || null,
  postSessionClassified: frame.ps === true,
  scorable: frame.sc !== false,
  ruleEngineAnalysis: frame.rc
    ? {
        corrected: {
          rep_id: frame.rc.r ?? null,
          rep_state: frame.rc.rs ?? null,
          step: frame.rc.s ?? null,
          phase: frame.rc.p ?? null,
          confidence: frame.rc.c ?? null,
          tracking_lost: frame.rc.tl === true,
          unknown_movement: frame.rc.u === true
        }
      }
    : null
});

const analyzePracticeTape = ({
  sourceFrames,
  durationMs,
  steps,
  targetReps,
  countMarkers,
  countGapMs
}) => {
  const completedTape = buildThirtyFpsTape(sourceFrames, durationMs);
  const countStepIndex = steps.findIndex((step) => step.counts_rep);
  const reclassifiedTape = reclassifyPracticeSequence(completedTape, {
    countStep: countStepIndex >= 0 ? countStepIndex + 1 : undefined,
    stepCount: steps.length,
    targetReps
  });
  const rescoredTape = reclassifiedTape.map((frame) => {
    const numericStepScores = (frame.stepScores || []).map(
      (score) => Number(score) || 0
    );
    const strongestScore = Math.max(0, ...numericStepScores);
    const strongestStepIndex = numericStepScores.indexOf(strongestScore);
    const runnerUpScore = Math.max(
      0,
      ...numericStepScores.filter((_, index) => index !== strongestStepIndex)
    );
    const evidenceStep =
      strongestScore >= 80 && strongestScore - runnerUpScore >= 6
        ? strongestStepIndex + 1
        : null;
    const scoringStep = frame.scorable
      ? frame.step
      : evidenceStep;

    if (!scoringStep) {
      return {
        ...frame,
        accuracy: null,
        focusBodyPart: null,
        issue: "transition",
        wrongBodyParts: []
      };
    }

    const result = scorePracticeAngles(
      steps[Math.max(0, scoringStep - 1)]?.angles || [],
      frame.angles || {}
    );
    return {
      ...frame,
      scoreStep: scoringStep,
      scoreSource: frame.scorable ? "sequence" : "dominant_pose_evidence",
      scorable: true,
      accuracy: result.accuracy,
      focusBodyPart: result.focusBodyPart,
      issue: result.issue,
      wrongBodyParts: result.wrongBodyParts
    };
  });

  return trimPracticeTapeFrames(
    attachCountAttention(rescoredTape, countMarkers, countGapMs),
    {
      paddingBeforeMs: PRACTICE_PRE_ROLL_MS,
      paddingAfterMs: PRACTICE_POST_ROLL_MS
    }
  );
};

const buildRepTapeFromFrames = (frames, steps) =>
  [...new Set(frames.map((frame) => frame.analysisRep ?? frame.rep))]
    .filter((rep) => Number.isFinite(Number(rep)))
    .sort((a, b) => a - b)
    .map((rep) => {
      const repFrames = frames.filter(
        (frame) => (frame.analysisRep ?? frame.rep) === rep
      );
      const scoredRepFrames = repFrames.filter(
        (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
      );
      const weakestFrame = scoredRepFrames.reduce(
        (weakest, frame) =>
          !weakest || frame.accuracy < weakest.accuracy ? frame : weakest,
        null
      );
      const accuracy = scoredRepFrames.length
        ? Math.round(
            scoredRepFrames.reduce((total, frame) => total + frame.accuracy, 0) /
              scoredRepFrames.length
          )
        : 0;
      return {
        rep,
        elapsedMs: repFrames[0]?.elapsedMs ?? 0,
        durationMs: Math.max(
          0,
          (repFrames[repFrames.length - 1]?.elapsedMs || 0) -
            (repFrames[0]?.elapsedMs || 0)
        ),
        accuracy,
        clean: accuracy >= CLEAN_ACCURACY,
        focusBodyPart: weakestFrame?.focusBodyPart || null,
        issue: weakestFrame?.issue || null,
        landmarks: weakestFrame?.landmarks || [],
        stepResults: steps.map((step, index) => {
          const stepFrames = scoredRepFrames.filter(
            (frame) => frame.step === index + 1
          );
          const stepWeakest = stepFrames.reduce(
            (weakest, frame) =>
              !weakest || frame.accuracy < weakest.accuracy ? frame : weakest,
            null
          );
          return {
            step: index + 1,
            name: step?.step_name || `Step ${index + 1}`,
            accuracy: stepFrames.length
              ? Math.round(
                  stepFrames.reduce(
                    (total, frame) => total + (frame.accuracy || 0),
                    0
                  ) / stepFrames.length
                )
              : 0,
            captured: Boolean(stepFrames.length),
            focusBodyPart: stepWeakest?.focusBodyPart || null,
            issue: stepWeakest?.issue || "not_reached",
            landmarks: stepWeakest?.landmarks || []
          };
        })
      };
    });

const getPoseMotion = (previous = [], current = []) => {
  const distances = MOTION_JOINTS.map((index) => {
    const from = previous[index];
    const to = current[index];
    return from && to ? Math.hypot(to.x - from.x, to.y - from.y) : null;
  }).filter(Number.isFinite);
  return distances.length
    ? distances.reduce((total, distance) => total + distance, 0) / distances.length
    : 0;
};

function TapeSkeleton({
  facePoints = [],
  handPoints = {},
  highlightBodyPart,
  highlightBodyParts = [],
  landmarks,
  mirrored = true,
  overlay = false
}) {
  const points = Array.isArray(landmarks) ? landmarks : [];
  const highlightedJoints = new Set(
    [highlightBodyPart, ...highlightBodyParts]
      .filter(Boolean)
      .flatMap((bodyPart) => TAPE_HIGHLIGHT_JOINTS[bodyPart] || [])
  );
  const pointAt = (index) => {
    const point = points[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * (overlay ? 75 : 100)
    };
  };
  const detailPoint = (point) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * (overlay ? 75 : 100)
    };
  };
  const faceMap = new Map(facePoints.map((point) => [point.index, point]));
  const isPoseFace = facePoints.length > 0 && facePoints.length <= 12;
  const faceConnections = isPoseFace
    ? TAPE_POSE_FACE_CONNECTIONS
    : TAPE_FACE_CONTOURS.flatMap((contour) =>
        contour.slice(1).map((to, index) => [contour[index], to])
      );
  const isFaceWrong = ["eyes_forward", "face_forward", "face_calm"]
    .some((part) => highlightBodyPart === part || highlightBodyParts.includes(part));

  return (
    <svg
      aria-hidden="true"
      className={`practice-tape-skeleton ${overlay ? "practice-tape-skeleton--overlay" : ""}`}
      viewBox={overlay ? "0 0 100 75" : "0 0 100 100"}
    >
      {faceConnections.map(([from, to]) => {
        const start = detailPoint(faceMap.get(from));
        const end = detailPoint(faceMap.get(to));
        return start && end ? (
          <line
            className={`is-detail ${isFaceWrong ? "is-wrong" : ""}`}
            key={`face-${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        ) : null;
      })}
      {Object.entries(handPoints).flatMap(([side, hand]) => {
        const handMap = new Map((hand || []).map((point) => [point.index, point]));
        const poseHand = handMap.size > 0 && handMap.size <= 4;
        const connections = poseHand ? [[0, 4], [0, 8], [0, 20]] : TAPE_HAND_CONNECTIONS;
        const handWrong = [`fist_${side}`, `hand_${side}_open`, `wrist_${side}`]
          .some((part) => highlightBodyPart === part || highlightBodyParts.includes(part));
        return connections.map(([from, to]) => {
          const start = detailPoint(handMap.get(from));
          const end = detailPoint(handMap.get(to));
          return start && end ? (
            <line
              className={`is-detail ${handWrong ? "is-wrong" : ""}`}
              key={`hand-${side}-${from}-${to}`}
              x1={start.x}
              x2={end.x}
              y1={start.y}
              y2={end.y}
            />
          ) : null;
        });
      })}
      {TAPE_CONNECTIONS.map(([from, to]) => {
        const start = pointAt(from);
        const end = pointAt(to);
        return start && end ? (
          <line
            className={highlightedJoints.has(from) || highlightedJoints.has(to) ? "is-wrong" : ""}
            key={`${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        ) : null;
      })}
      {TAPE_VISIBLE_JOINTS.map((index) => {
        const point = pointAt(index);
        return point ? (
          <circle
            className={highlightedJoints.has(index) ? "is-wrong" : ""}
            cx={point.x}
            cy={point.y}
            key={index}
            r={index === 0 ? 3 : 1.8}
          />
        ) : null;
      })}
      {facePoints
        .filter((point) => isPoseFace || TAPE_FACE_INDICES.has(point.index))
        .map((point) => {
          const position = detailPoint(point);
          return position ? (
            <circle
              className={`is-detail ${isFaceWrong ? "is-wrong" : ""}`}
              cx={position.x}
              cy={position.y}
              key={`face-point-${point.index}`}
              r={isPoseFace ? 1.1 : 0.55}
            />
          ) : null;
        })}
      {Object.entries(handPoints).flatMap(([side, hand]) =>
        (hand || []).map((point) => {
          const position = detailPoint(point);
          return position ? (
            <circle
              className="is-detail"
              cx={position.x}
              cy={position.y}
              key={`hand-point-${side}-${point.index}`}
              r="0.75"
            />
          ) : null;
        })
      )}
      {!points.length ? (
        <text x="50" y="52" textAnchor="middle">POSE</text>
      ) : null}
    </svg>
  );
}

function LandmarkDetailSkeleton({ kind, points = [], mirrored = true }) {
  if (!points.length) {
    return (
      <svg aria-hidden="true" className="practice-landmark-detail" viewBox="0 0 100 64">
        <text x="50" y="35" textAnchor="middle">WAITING</text>
      </svg>
    );
  }

  const pointMap = new Map(points.map((point) => [point.index, point]));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);
  const scale = Math.min(84 / width, 52 / height);
  const offsetX = (100 - width * scale) / 2;
  const offsetY = (64 - height * scale) / 2;
  const toPoint = (point) => ({
    x: mirrored
      ? 100 - (offsetX + (point.x - minX) * scale)
      : offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale
  });
  const isPoseDetail = points.length <= (kind === "face" ? 12 : 4);
  const connections = kind === "face"
    ? isPoseDetail
      ? TAPE_POSE_FACE_CONNECTIONS
      : TAPE_FACE_CONTOURS.flatMap((contour) =>
          contour.slice(1).map((to, index) => [contour[index], to])
        )
    : isPoseDetail
      ? [[0, 4], [0, 8], [0, 20]]
      : TAPE_HAND_CONNECTIONS;

  return (
    <svg aria-hidden="true" className="practice-landmark-detail" viewBox="0 0 100 64">
      {connections.map(([from, to]) => {
        const fromPoint = pointMap.get(from);
        const toLandmark = pointMap.get(to);
        if (!fromPoint || !toLandmark) return null;
        const start = toPoint(fromPoint);
        const end = toPoint(toLandmark);
        return (
          <line
            key={`${kind}-${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        );
      })}
      {points.map((point) => {
        const position = toPoint(point);
        return (
          <circle
            cx={position.x}
            cy={position.y}
            key={`${kind}-point-${point.index}`}
            r={kind === "face" && !isPoseDetail ? .8 : 1.35}
          />
        );
      })}
    </svg>
  );
}

function PracticeAccuracyTimeline({
  countFilter = "all",
  contentWidth = 470,
  expanded = false,
  frames = [],
  onScroll,
  onSelectFrame,
  scrollRef,
  selectedFrame,
  stepFilter = "all"
}) {
  const plot = { left: 0, top: 8, width: contentWidth, height: expanded ? 82 : 44 };
  const chartHeight = expanded ? 112 : 72;
  const duration = Math.max(frames[frames.length - 1]?.elapsedMs || 0, 1);
  const stride = Math.max(1, Math.ceil(frames.length / (expanded ? 180 : 100)));
  const sampled = frames.filter(
    (frame, index) =>
      Number.isFinite(frame.accuracy) &&
      (index % stride === 0 || index === frames.length - 1)
  );
  const xAt = (elapsedMs) => plot.left + (elapsedMs / duration) * plot.width;
  const yAt = (accuracy) =>
    plot.top + plot.height - (Math.max(0, Math.min(100, accuracy || 0)) / 100) * plot.height;
  const linePoints = sampled
    .map((frame) => `${xAt(frame.elapsedMs).toFixed(1)},${yAt(frame.accuracy).toFixed(1)}`)
    .join(" ");
  const frameMatchesFilter = (frame) =>
    Number.isFinite(frame.accuracy) &&
    (
      countFilter === "all" ||
      (frame.analysisRep ?? frame.rep) === Number(countFilter)
    ) &&
    (stepFilter === "all" ||
      (frame.step === Number(stepFilter) && frame.scorable !== false));
  const activeSegments = frames.reduce((segments, frame) => {
    if (!frameMatchesFilter(frame)) return segments;
    const previousSegment = segments[segments.length - 1];
    const previousFrame = previousSegment?.[previousSegment.length - 1];
    if (!previousFrame || frame.frame !== previousFrame.frame + 1) {
      segments.push([frame]);
    } else {
      previousSegment.push(frame);
    }
    return segments;
  }, []);
  const countMarkers = Array.from(
    frames.reduce((markers, frame) => {
      if (frame.countCue && !markers.has(frame.countCue)) {
        markers.set(frame.countCue, frame.countTimestampMs ?? frame.elapsedMs);
      }
      return markers;
    }, new Map()).entries()
  );
  const dropPoints = frames
    .filter(frameMatchesFilter)
    .filter((frame) => {
      const previous = frames[frame.frame - 2];
      const next = frames[frame.frame];
      return frame.accuracy < CLEAN_ACCURACY &&
        (!previous || frame.accuracy <= previous.accuracy) &&
        (!next || frame.accuracy <= next.accuracy);
    })
    .filter((_, index, points) => {
      const previous = points[index - 1];
      return !previous || _.elapsedMs - previous.elapsedMs >= 250;
    })
    .sort((left, right) => left.accuracy - right.accuracy)
    .slice(0, expanded ? 12 : 6)
    .sort((left, right) => left.elapsedMs - right.elapsedMs);

  return (
    <div className={`practice-accuracy-timeline ${expanded ? "is-expanded" : ""}`}>
      <div className="practice-accuracy-timeline__heading">
        <div>
          <span>Session accuracy</span>
          <strong>One line · X time · Y accuracy</strong>
        </div>
        <span><i /> Accuracy drop</span>
      </div>
      <div
        className="practice-accuracy-timeline__scroller"
        onScroll={onScroll}
        ref={scrollRef}
      >
        <svg
          aria-label="Session accuracy over time with selectable accuracy drops"
          className="practice-accuracy-timeline__plot"
          role="img"
          style={{ height: `${chartHeight}px`, width: `${contentWidth}px` }}
          viewBox={`0 0 ${contentWidth} ${chartHeight}`}
        >
          <line
            className="is-target"
            x1={plot.left}
            x2={plot.left + plot.width}
            y1={yAt(CLEAN_ACCURACY)}
            y2={yAt(CLEAN_ACCURACY)}
          />
          {countMarkers.map(([rep, elapsedMs]) => (
            <g key={`timeline-count-${rep}`}>
              <line
                className="is-count-marker"
                x1={xAt(elapsedMs)}
                x2={xAt(elapsedMs)}
                y1={plot.top}
                y2={plot.top + plot.height}
              />
              <text className="is-count-label" x={xAt(elapsedMs) + 3} y={plot.top + 8}>
                C{rep}
              </text>
            </g>
          ))}
          <text x="3" y={yAt(CLEAN_ACCURACY) - 3}>80%</text>
          <text x="3" y={chartHeight - 2}>0:00</text>
          <text x={contentWidth - 3} y={chartHeight - 2} textAnchor="end">
            {formatTapeTime(duration)}
          </text>
          <polyline className="is-context" points={linePoints} />
          {activeSegments.map((segment, segmentIndex) => {
            const segmentStride = Math.max(
              1,
              Math.ceil(segment.length / (expanded ? 180 : 100))
            );
            const points = segment
              .filter(
                (_, index) =>
                  index % segmentStride === 0 || index === segment.length - 1
              )
              .map(
                (frame) =>
                  `${xAt(frame.elapsedMs).toFixed(1)},${yAt(frame.accuracy).toFixed(1)}`
              )
              .join(" ");
            return (
              <polyline
                className="is-active"
                key={`active-accuracy-${segmentIndex}`}
                points={points}
              />
            );
          })}
          {dropPoints.map((frame) => (
            <circle
              aria-label={`Accuracy drop at ${formatTapeTime(frame.elapsedMs)}, rep ${frame.analysisRep ?? frame.rep}, step ${frame.step}, ${frame.accuracy}%`}
              className={frame.frame - 1 === selectedFrame ? "is-selected" : ""}
              cx={xAt(frame.elapsedMs)}
              cy={yAt(frame.accuracy)}
              key={`accuracy-drop-${frame.frame}`}
              onClick={() => onSelectFrame?.(frame.frame - 1)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectFrame?.(frame.frame - 1);
                }
              }}
              r={frame.frame - 1 === selectedFrame ? 4.5 : 3.2}
              role="button"
              tabIndex={0}
            >
              <title>
                {`Rep ${frame.analysisRep ?? frame.rep} · Step ${frame.step} · ${frame.accuracy}% · ${formatTapeTime(frame.elapsedMs)}`}
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}

function PracticeSessionMap({
  analysis,
  onSelectFrame,
  selectedFrame
}) {
  const [showAdvancedTimeline, setShowAdvancedTimeline] = useState(false);
  if (!analysis?.segments?.length) return null;
  const timelineView = selectPracticeTimelineView(analysis, {
    advanced: showAdvancedTimeline
  });
  const durationMs = Math.max(
    timelineView.end_ms - timelineView.start_ms,
    1
  );
  const timelineRange = (startMs, rangeDurationMs, minimumWidth = 0.35) => {
    const left = Math.min(
      100,
      Math.max(
        0,
        ((Math.max(timelineView.start_ms, Number(startMs) || 0) -
          timelineView.start_ms) /
          durationMs) *
          100
      )
    );
    const clippedEnd = Math.min(
      timelineView.end_ms,
      (Number(startMs) || 0) + Math.max(Number(rangeDurationMs) || 0, 34)
    );
    const width = Math.min(
      100 - left,
      Math.max(
        minimumWidth,
        ((clippedEnd -
          Math.max(timelineView.start_ms, Number(startMs) || 0)) /
          durationMs) *
          100
      )
    );
    return { left, width };
  };

  return (
    <section className="practice-session-map" aria-label="Canonical session map">
      <div className="practice-session-map__header">
        <div>
          <p className="eyebrow">Session map</p>
          <strong>Movement timeline</strong>
        </div>
        <div className="practice-session-map__header-actions">
          <button
            aria-pressed={showAdvancedTimeline}
            onClick={() => setShowAdvancedTimeline((isVisible) => !isVisible)}
            type="button"
          >
            {showAdvancedTimeline ? "Hide advanced" : "Advanced frames"}
          </button>
          <span>
            {analysis.clustered_completed_repetitions}/
            {analysis.target_repetitions} completed
          </span>
        </div>
      </div>

      <div className="practice-session-map__timeline">
        <div className="practice-session-map__tracks">
          <div className="practice-session-map__segments">
            {timelineView.segments.map((segment, index) => {
              const selected =
                selectedFrame >= segment.start_frame_index &&
                selectedFrame <= segment.end_frame_index;
              const range = timelineRange(
                segment.start_ms,
                segment.duration_ms
              );
              return (
                <button
                  className={`is-${segment.kind} ${segment.has_review ? "has-review" : ""} ${selected ? "is-selected" : ""}`}
                  key={`${segment.key}:${segment.start_frame_index}:${index}`}
                  onClick={() => onSelectFrame?.(segment.start_frame_index)}
                  style={{
                    "--segment-left": `${range.left}%`,
                    "--segment-width": `${range.width}%`
                  }}
                  title={`${segment.kind === "repetition" ? `Rep ${segment.rep} · ${segment.step_name}` : segment.phase_label} · ${segment.phase_label} · ${Math.round(segment.duration_ms)} ms`}
                  type="button"
                >
                  <span>
                    {segment.kind === "preparation"
                      ? "PREP"
                      : segment.kind === "tracking"
                        ? "LOST"
                        : segment.kind === "unconfirmed"
                          ? "UNCONF"
                        : segment.kind === "complete"
                          ? "END"
                          : `R${segment.rep} S${segment.step}`}
                  </span>
                  <small>{segment.phase_label}</small>
                </button>
              );
            })}
          </div>

          <div className="practice-session-map__reps">
            {analysis.repetitions.map((repetition) => {
              const range = timelineRange(
                repetition.start_ms,
                repetition.duration_ms,
                1
              );
              return (
                <button
                  className={`is-${repetition.status}`}
                  key={`session-map-rep-${repetition.rep}`}
                  onClick={() =>
                    onSelectFrame?.(repetition.start_frame_index)
                  }
                  style={{
                    "--rep-left": `${range.left}%`,
                    "--rep-width": `${range.width}%`
                  }}
                  type="button"
                >
                  <span>Rep {repetition.rep}</span>
                  <strong>{repetition.status}</strong>
                  <small>
                    {repetition.step_coverage_percentage}% steps ·{" "}
                    {Number.isFinite(repetition.average_accuracy)
                      ? `${Math.round(repetition.average_accuracy)}% form`
                      : "form unavailable"}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Whole form";

const getFrameRuleErrors = (frame) => {
  const analysis =
    frame?.ruleEngineAnalysis?.corrected ||
    frame?.ruleEngineAnalysis?.raw;
  return Array.isArray(analysis?.form_errors) ? analysis.form_errors : [];
};

const formatFistAnalysis = (score, pointCount) => {
  if (Number.isFinite(score)) {
    return `${score >= 55 ? "Closed" : "Open"} · ${Math.round(score)}% closed`;
  }
  return pointCount > 4 ? "21 points · shape unavailable" : "Pose tracked";
};

const formatSessionTimestamp = (value) => {
  if (!value) return "No completed set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

function speedLabel(durationMs) {
  if (durationMs <= 900) return "fast";
  if (durationMs >= 2400) return "slow";
  return "steady";
}

function parseCountCommand(message) {
  const normalized = message.toLowerCase();
  const numericCount = normalized.match(/\b(\d{1,2})\b/);
  if (numericCount) {
    const count = Number(numericCount[1]);
    if (count >= 1 && count <= 50) return count;
  }
  if (/\bthree\b/.test(normalized)) return 3;
  if (/\bfive\b/.test(normalized)) return 5;
  if (/\bten\b/.test(normalized)) return 10;
  return null;
}

function classifyPracticeCommand(message) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const requestedCount = parseCountCommand(normalized);

  if (requestedCount && /\b(count|reps?|repetitions?)\b/.test(normalized)) {
    return { intent: "set_count", count: requestedCount };
  }
  if (/\b(not ready|wait|pause|hold on|not now)\b/.test(normalized)) {
    return { intent: "wait" };
  }
  if (/\b(reset|stop|cancel)\b/.test(normalized)) {
    return { intent: "reset" };
  }
  if (/\b(analysis|results?|review)\b/.test(normalized)) {
    return { intent: "analysis" };
  }
  if (/\b(train|training mode|guided training)\b/.test(normalized)) {
    return { intent: "train" };
  }
  if (/\b(previous|back|prior step)\b/.test(normalized)) {
    return { intent: "previous" };
  }
  if (/\b(next|next step|move on)\b/.test(normalized)) {
    return { intent: "next" };
  }
  if (/\b(start|begin|go|ready|yes|practice again|again)\b/.test(normalized)) {
    return { intent: "start" };
  }

  return { intent: "unknown" };
}

export default function PracticeMode({
  categorySlug,
  displayMirrored = true,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug,
  textEnabled = true,
  voiceEnabled = true,
  isAdminStudio = false,
  performanceProfile = "student",
  performanceMode = "auto",
  skeletonLayers = {},
  bodyCalibration,
  inputSource = "live",
  inputVideoUrl,
  inputVideoName,
  onInputStatus,
  onPredictionStatus
}) {
  const currentTechnique = useMemo(
    () =>
      getTechniqueFromCatalog({
        categorySlug,
        subcategorySlug,
        techniqueName: selectedTechniqueName
      }),
    [categorySlug, selectedTechniqueName, subcategorySlug]
  );
  const practiceSessionConfig = useMemo(
    () => ({
      technique_name: currentTechnique?.name || null,
      mode: "practice"
    }),
    [currentTechnique?.name]
  );
  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const selectedStep = steps[selectedStepIndex] || steps[0];
  const requiredParts = useMemo(() => selectedStep?.angles || [], [selectedStep]);
  const practiceFeedbackParts = useMemo(
    () => [
      ...(selectedStep?.evaluation_profile?.full_body_angles || []),
      ...(selectedStep?.quality_targets || []).map((target) => ({
        ...target,
        body_part: target.body_part || target.feature
      }))
    ],
    [selectedStep]
  );
  const measurementParts = useMemo(() => {
    const parts = new Map();
    steps.flatMap(
      (step) => step?.evaluation_profile?.full_body_angles || step?.angles || []
    ).forEach((part) => {
      if (!parts.has(part.body_part)) parts.set(part.body_part, part);
    });
    return [...parts.values()];
  }, [steps]);
  const [targetReps, setTargetReps] = useState(5);
  const [countGapMs, setCountGapMs] = useState(2000);
  const [session, setSession] = useState(null);
  const [repCount, setRepCount] = useState(0);
  const [cueCount, setCueCount] = useState(0);
  const [temporalCue, setTemporalCue] = useState(null);
  const [temporalSessionId, setTemporalSessionId] = useState(0);
  const [cleanReps, setCleanReps] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [focusBodyPart, setFocusBodyPart] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState(
    "Choose a count and start practice."
  );
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [ruleEngineLiveFrame, setRuleEngineLiveFrame] = useState(null);
  const [ruleEngineLiveEvents, setRuleEngineLiveEvents] = useState([]);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [showDataLayers, setShowDataLayers] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [conversation, setConversation] = useState([
    { role: "ai", text: "Choose a count and say start when ready." }
  ]);
  const [practiceInput, setPracticeInput] = useState("");
  const [voiceInputStatus, setVoiceInputStatus] = useState("Say start to begin.");
  const [isListening, setIsListening] = useState(false);
  const [isReadyForRep, setIsReadyForRep] = useState(true);
  const [practiceAnalysis, setPracticeAnalysis] = useState(null);
  const [repTape, setRepTape] = useState([]);
  const [tapeCursor, setTapeCursor] = useState(0);
  const [, setTapeStepCursor] = useState(0);
  const [isTapePlaying, setIsTapePlaying] = useState(false);
  const [fullTapeFrames, setFullTapeFrames] = useState([]);
  const [analysisTapeMetadata, setAnalysisTapeMetadata] = useState(null);
  const [fullTapeCursor, setFullTapeCursor] = useState(0);
  const [isFullTapePlaying, setIsFullTapePlaying] = useState(false);
  const [isTapePopupOpen, setIsTapePopupOpen] = useState(false);
  const [isTapePopupExpanded, setIsTapePopupExpanded] = useState(true);
  const [isCameraRollExpanded, setIsCameraRollExpanded] = useState(false);
  const [showRawFrameInspector, setShowRawFrameInspector] = useState(false);
  const [cameraRollZoom, setCameraRollZoom] = useState(3);
  const [analysisCountFilter, setAnalysisCountFilter] = useState("all");
  const [analysisStepFilter, setAnalysisStepFilter] = useState("all");
  const [historySessionPopup, setHistorySessionPopup] = useState(null);
  const [sessionSortDirection, setSessionSortDirection] = useState("desc");
  const [recoveryRemainingMs, setRecoveryRemainingMs] = useState(0);
  const ruleEngineResultRef = useRef(null);
  const ruleEngineWaitersRef = useRef(new Set());
  const handleRuleEngineSessionComplete = useCallback((summary) => {
    if (!summary) return;
    const rawFrames = summary.raw_timeline?.frames || [];
    const corrected = summary.corrected_timeline;
    const correctedFrames = corrected?.frames || [];
    const compactSummary = { ...summary };
    delete compactSummary.raw_timeline;
    delete compactSummary.corrected_timeline;

    const ruleEngineAnalysis = {
      summary: compactSummary,
      corrections: corrected?.corrections || [],
      segments: corrected?.segments || [],
      repetitions: corrected?.repetitions || []
    };
    const result = {
      ruleEngineAnalysis,
      rawFrames,
      correctedFrames
    };
    ruleEngineResultRef.current = result;
    ruleEngineWaitersRef.current.forEach((resolve) => resolve(result));
    ruleEngineWaitersRef.current.clear();

    setFullTapeFrames((frames) =>
      attachRuleEngineAnalysisToTape(frames, {
        rawFrames,
        correctedFrames
      })
    );
    setAnalysisTapeMetadata((metadata) => ({
      ...(metadata || {}),
      ruleEngineAnalysis
    }));
  }, []);
  const handleRuleEngineLiveFrame = useCallback((frame) => {
    setRuleEngineLiveFrame(frame);
    const event = frame?.temporal_event;
    if (!event?.id) return;
    setRuleEngineLiveEvents((current) => {
      if (current.some((item) => item.id === event.id)) return current;
      return [event, ...current].slice(0, 8);
    });
  }, []);
  const waitForRuleEngineResult = useCallback((timeoutMs = 1600) => {
    if (ruleEngineResultRef.current) {
      return Promise.resolve(ruleEngineResultRef.current);
    }
    return new Promise((resolve) => {
      let timerId;
      const finish = (result) => {
        window.clearTimeout(timerId);
        ruleEngineWaitersRef.current.delete(finish);
        resolve(result);
      };
      timerId = window.setTimeout(() => finish(null), timeoutMs);
      ruleEngineWaitersRef.current.add(finish);
    });
  }, []);
  const isPracticeActive = session?.status === "active";
  const practiceSkeletonLayers = useMemo(
    () => ({ ...skeletonLayers, live: false, expected: false }),
    [skeletonLayers]
  );
  const practiceNeedsReply = !isPracticeActive;
  const practiceReplyOptions = session?.status === "completed"
    ? [
        { label: "Practice again", value: "start" },
        { label: "View analysis", value: "analysis" },
        { label: "Training mode", value: "train" }
      ]
    : [
        { label: "Start set", value: "start" },
        { label: "3 reps", value: "count 3" },
        { label: "5 reps", value: "count 5" },
        { label: "10 reps", value: "count 10" }
      ];
  const repStartedAtRef = useRef(null);
  const setStartedAtRef = useRef(null);
  const latestLandmarksRef = useRef([]);
  const latestHolisticFrameRef = useRef({
    facePoints: [],
    handPoints: {},
    motionEnergy: 0,
    predictionAggregate: null
  });
  const previousRecordedLandmarksRef = useRef([]);
  const countMarkersRef = useRef([]);
  const isSetFinishingRef = useRef(false);
  const selectedStepIndexRef = useRef(0);
  const recordedFramesRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const cameraRollScrollRef = useRef(null);
  const accuracyTimelineScrollRef = useRef(null);
  const timelineScrollSyncRef = useRef(false);
  const recoveryEndsAtRef = useRef(null);
  const sessionRef = useRef(null);
  const repCountRef = useRef(0);
  const cueCountRef = useRef(0);
  const isReadyForRepRef = useRef(true);
  const countBeatRef = useRef(null);
  const countBeatTimersRef = useRef([]);
  const latestPracticeResultRef = useRef({
    accuracy: 0,
    focusBodyPart: null,
    issue: "waiting",
    wrongBodyParts: []
  });
  const movementClassifierRef = useRef(null);
  const latestMovementClassificationRef = useRef({
    rep: 1,
    step: 1,
    phase: "transition",
    temporalPhase: "waiting_for_movement",
    stateConfidence: 0,
    trackingReliable: true,
    scorable: false
  });
  const completedMovementRepsRef = useRef(new Set());
  const completeMovementRepRef = useRef(null);
  const recordFrameRef = useRef(null);
  const numberAudioRef = useRef([]);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(true);
  const restartListenTimerRef = useRef(null);
  const startVoiceInputRef = useRef(null);
  const currentAudioRef = useRef(null);
  const voiceQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const voiceRequestIdRef = useRef(0);
  const voiceCacheRef = useRef(new Map());
  const greetedTechniqueRef = useRef("");
  const attentionReminderTimerRef = useRef(null);
  const lastPracticeFeedbackIntentRef = useRef("");
  const lastPracticeSpokenIntentRef = useRef("");

  const tapeAnalysisSteps = analysisTapeMetadata?.steps?.length
    ? analysisTapeMetadata.steps
    : steps;
  const tapeTargetReps =
    analysisTapeMetadata?.authoritativeSession?.target_reps ||
    analysisTapeMetadata?.targetReps ||
    targetReps;
  const popupRepTape = analysisTapeMetadata?.repTape || repTape;
  const fullTapeDurationMs = fullTapeFrames.length
    ? (fullTapeFrames.length / 30) * 1000
    : 0;
  const scoredFullTapeFrames = fullTapeFrames.filter(
    (frame) => frame.scorable !== false && Number.isFinite(frame.accuracy)
  );
  const fullTapeAverageAccuracy = scoredFullTapeFrames.length
    ? Math.round(
        scoredFullTapeFrames.reduce((total, frame) => total + frame.accuracy, 0) /
          scoredFullTapeFrames.length
      )
    : 0;
  const authoritativeSession = analysisTapeMetadata?.authoritativeSession || null;
  const correctedRuleSummary = analysisTapeMetadata?.ruleEngineAnalysis?.summary || null;
  const canonicalSessionAnalysis = useMemo(
    () => buildPracticeSessionAnalysis(fullTapeFrames, {
      steps: tapeAnalysisSteps,
      targetReps: tapeTargetReps,
      strictSummary: correctedRuleSummary
    }),
    [
      correctedRuleSummary,
      fullTapeFrames,
      tapeAnalysisSteps,
      tapeTargetReps
    ]
  );
  const canonicalSessionMetrics = useMemo(
    () =>
      buildPracticeSessionMetrics(canonicalSessionAnalysis, {
        cleanAccuracy: CLEAN_ACCURACY
      }),
    [canonicalSessionAnalysis]
  );
  const analysisTapeFrames = useMemo(
    () => fullTapeFrames.map((frame, index) => {
      const assignment = canonicalSessionAnalysis.frame_assignments[index];
      return {
        ...frame,
        analysisKind: assignment?.kind || "preparation",
        analysisRep: assignment?.rep ?? null,
        scorable: assignment?.scorable === true,
        sourceStep: frame.step,
        step: assignment ? assignment.step : frame.step,
        sourceTemporalPhase: frame.temporalPhase,
        temporalPhase: assignment?.phase ?? frame.temporalPhase
      };
    }),
    [canonicalSessionAnalysis.frame_assignments, fullTapeFrames]
  );
  const fullTapeFrame = analysisTapeFrames[fullTapeCursor] || null;
  const correctedFrameState =
    fullTapeFrame?.ruleEngineAnalysis?.corrected ||
    fullTapeFrame?.ruleEngineAnalysis?.raw ||
    null;
  const fullTapeFrameIsPreparation =
    fullTapeFrame?.analysisKind !== "repetition";
  const displayedFrameRep = fullTapeFrame?.analysisRep;
  const fullTapeFrameScorable =
    fullTapeFrame?.scorable !== false &&
    Number.isFinite(fullTapeFrame?.accuracy);
  const fullTapeFrameRuleErrors = getFrameRuleErrors(fullTapeFrame);
  const fullTapeFrameNeedsReview =
    fullTapeFrameScorable &&
    (
      fullTapeFrameScorable &&
      fullTapeFrame.accuracy < CLEAN_ACCURACY
    || fullTapeFrameRuleErrors.length > 0
    );
  const timelineContentWidth = Math.max(
    900,
    analysisTapeFrames.length * cameraRollZoom
  );
  const filteredTapeFrames = filterPracticeTapeFrames(analysisTapeFrames, {
    rep: analysisCountFilter,
    step: analysisStepFilter
  });
  const cameraRollContentWidth = Math.max(
    900,
    filteredTapeFrames.length * cameraRollZoom
  );
  const cameraRollFrameWidth = filteredTapeFrames.length
    ? cameraRollContentWidth / filteredTapeFrames.length
    : cameraRollZoom;
  const hasActiveTapeFilter =
    analysisCountFilter !== "all" || analysisStepFilter !== "all";
  const filteredTapeCursorPosition = Math.max(
    0,
    filteredTapeFrames.findIndex((entry) => entry.index === fullTapeCursor)
  );
  const tapeRepFilterOptions = canonicalSessionAnalysis.repetitions.length
    ? canonicalSessionAnalysis.repetitions.map((repetition) => repetition.rep)
    : popupRepTape.map((repetition) => repetition.rep);
  const displayedSessionAverage = canonicalSessionMetrics.completed_reps
    ? Math.round(canonicalSessionMetrics.average_accuracy)
    : Number.isFinite(correctedRuleSummary?.average_accuracy)
      ? Math.round(correctedRuleSummary.average_accuracy * 100)
    : Number.isFinite(authoritativeSession?.average_accuracy)
      ? Math.round(authoritativeSession.average_accuracy)
    : fullTapeAverageAccuracy;
  const displayedCompletedReps = Number.isFinite(
    canonicalSessionAnalysis?.clustered_completed_repetitions
  )
    ? canonicalSessionAnalysis.clustered_completed_repetitions
    : Number.isFinite(analysisTapeMetadata?.clusteredCompletedReps)
      ? analysisTapeMetadata.clusteredCompletedReps
    : Number.isFinite(analysisTapeMetadata?.completedReps)
      ? analysisTapeMetadata.completedReps
    : Number.isFinite(authoritativeSession?.completed_reps)
      ? authoritativeSession.completed_reps
    : Number.isFinite(correctedRuleSummary?.completed_repetitions)
      ? correctedRuleSummary.completed_repetitions
    : popupRepTape.length;
  const fullTapeReviewFrames = analysisTapeFrames.filter(
    (frame) =>
      frame.scorable === true &&
      (
        frame.scorable !== false &&
        Number.isFinite(frame.accuracy) &&
        frame.accuracy < CLEAN_ACCURACY
      || getFrameRuleErrors(frame).length > 0
      )
  ).length;
  const fullTapeIssueCounts = analysisTapeFrames
    .filter((frame) => frame.scorable && Number.isFinite(frame.accuracy))
    .reduce((counts, frame) => {
    (frame.wrongBodyParts || []).forEach((bodyPart) => {
      counts[bodyPart] = (counts[bodyPart] || 0) + 1;
    });
    return counts;
    }, {});
  const fullTapePrimaryIssue = Object.entries(fullTapeIssueCounts).sort(
    (left, right) => right[1] - left[1]
  )[0]?.[0] || null;
  const canonicalAccuracyValues = canonicalSessionAnalysis.repetitions
    .filter((repetition) => repetition.status === "completed")
    .map((repetition) => Number(repetition.average_accuracy))
    .filter(Number.isFinite);
  const repAccuracyValues = canonicalAccuracyValues.length
    ? canonicalAccuracyValues
    : popupRepTape.map((rep) => rep.accuracy);
  const repAccuracyMean = repAccuracyValues.length
    ? repAccuracyValues.reduce((total, value) => total + value, 0) / repAccuracyValues.length
    : 0;
  const sequenceConsistency = repAccuracyValues.length
    ? Math.max(
        0,
        Math.round(
          100 -
            Math.sqrt(
              repAccuracyValues.reduce(
                (total, value) => total + (value - repAccuracyMean) ** 2,
                0
              ) / repAccuracyValues.length
            )
        )
      )
    : 0;
  const fullTapeRecommendation =
    canonicalSessionMetrics.average_accuracy >= CLEAN_ACCURACY
    ? "Keep this rhythm and repeat the same clean movement."
    : fullTapePrimaryIssue
      ? `Repeat slowly while focusing on ${formatBodyPart(fullTapePrimaryIssue)}.`
      : "Repeat once with your full body visible so every angle can be measured.";

  selectedStepIndexRef.current = selectedStepIndex;

  const syncTimelineScroll = useCallback((source, targetRef) => {
    if (timelineScrollSyncRef.current || !targetRef.current) return;
    timelineScrollSyncRef.current = true;
    const sourceRange = Math.max(1, source.scrollWidth - source.clientWidth);
    const targetRange = Math.max(
      0,
      targetRef.current.scrollWidth - targetRef.current.clientWidth
    );
    targetRef.current.scrollLeft = (source.scrollLeft / sourceRange) * targetRange;
    window.requestAnimationFrame(() => {
      timelineScrollSyncRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!isTapePlaying || !repTape.length) return undefined;

    const timerId = window.setTimeout(() => {
      setTapeStepCursor(0);
      setTapeCursor((current) => {
        if (current >= repTape.length - 1) {
          setIsTapePlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Math.max(650, Math.min(repTape[tapeCursor + 1]?.durationMs || 1000, 1800)));

    return () => window.clearTimeout(timerId);
  }, [isTapePlaying, repTape, tapeCursor]);

  useEffect(() => {
    if (!isFullTapePlaying || !analysisTapeFrames.length) return undefined;

    const timerId = window.setInterval(() => {
      setFullTapeCursor((current) => {
        for (let next = current + 1; next < analysisTapeFrames.length; next += 1) {
          const frame = analysisTapeFrames[next];
          const matchesCount =
            analysisCountFilter === "all" ||
            frame.analysisRep === Number(analysisCountFilter);
          const matchesStep =
            analysisStepFilter === "all" || frame.step === Number(analysisStepFilter);
          if (matchesCount && matchesStep) return next;
        }
        setIsFullTapePlaying(false);
        return current;
      });
    }, 1000 / 30);

    return () => window.clearInterval(timerId);
  }, [
    analysisCountFilter,
    analysisStepFilter,
    analysisTapeFrames,
    isFullTapePlaying
  ]);

  useEffect(() => {
    if (!isPracticeActive || !recoveryEndsAtRef.current) {
      setRecoveryRemainingMs(0);
      return undefined;
    }

    const updateRecovery = () => {
      const remaining = Math.max(0, recoveryEndsAtRef.current - performance.now());
      setRecoveryRemainingMs(remaining);
      if (!remaining) recoveryEndsAtRef.current = null;
    };
    updateRecovery();
    const timerId = window.setInterval(updateRecovery, 100);
    return () => window.clearInterval(timerId);
  }, [cueCount, isPracticeActive, repCount]);

  const appendConversation = useCallback((item) => {
    if (!textEnabled) return;
    setConversation((items) => [...items.slice(-7), item]);
  }, [textEnabled]);

  const handleLevel1Update = useCallback((nextState) => {
    setLevel1State(nextState);
    if (nextState?.debug?.currentLandmarks?.length) {
      latestLandmarksRef.current = nextState.debug.currentLandmarks;
    }
  }, []);

  const handleLandmarkFrame = useCallback((frame) => {
    latestLandmarksRef.current = frame?.pose || [];
    latestHolisticFrameRef.current = frame || {
      facePoints: [],
      handPoints: {},
      motionEnergy: 0
    };

    if (!shouldProcessPracticeFrame({
      sessionStatus: sessionRef.current?.status,
      classifierReady: Boolean(movementClassifierRef.current),
      recordingStarted: Boolean(setStartedAtRef.current && recordFrameRef.current),
      cueStarted: cueCountRef.current > 0
    })) {
      return;
    }

    const stepScores = steps.map((step) =>
      scorePracticeAngles(step?.angles || [], frame?.angles || {}).accuracy
    );
    latestHolisticFrameRef.current = {
      ...latestHolisticFrameRef.current,
      stepScores
    };
    const classification = movementClassifierRef.current.update({
      motionScore: frame?.motionEnergy || 0,
      stepScores,
      trackingConfidence: frame?.trackingConfidence
    });
    latestMovementClassificationRef.current = {
      rep: classification.rep,
      step: classification.step,
      phase: classification.phase,
      temporalPhase: classification.temporalPhase,
      stateConfidence: classification.stateConfidence,
      trackingReliable: classification.trackingReliable,
      scorable: classification.scorable
    };

    const nextStepIndex = Math.max(0, classification.expectedStep - 1);
    if (nextStepIndex !== selectedStepIndexRef.current) {
      selectedStepIndexRef.current = nextStepIndex;
      setSelectedStepIndex(nextStepIndex);
      setTapeStepCursor(nextStepIndex);
    }

    if (classification.countedRep) {
      repCountRef.current = classification.countedRep;
      setRepCount(classification.countedRep);
      setTapeCursor(classification.countedRep - 1);
    }

    if (classification.completedRep) {
      recordFrameRef.current?.();
      window.setTimeout(() => {
        completeMovementRepRef.current?.(
          classification.completedRep,
          performance.now()
        );
      }, 0);
    }
  }, [steps]);

  const loadPracticeAnalysis = useCallback(async (signal) => {
    const token = getAccessToken();
    if (!token || !currentTechnique?.name) return;

    try {
      const query = new URLSearchParams({
        technique_name: currentTechnique.name
      });
      const response = await authFetch(`${API_BASE_URL}/practice/analysis?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });
      if (response.ok) {
        setPracticeAnalysis(await response.json());
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        // Practice remains usable when historical analysis is temporarily offline.
      }
    }
  }, [currentTechnique?.name]);

  useEffect(() => {
    const controller = new AbortController();
    setPracticeAnalysis(null);
    loadPracticeAnalysis(controller.signal);
    return () => controller.abort();
  }, [loadPracticeAnalysis]);

  const fetchPracticeVoice = useCallback(async (message) => {
    const trimmed = message.trim();
    if (!voiceEnabled || !trimmed) return null;

    const cacheKey = `${PRACTICE_VOICE_GENDER}:${trimmed}`;
    const cached = voiceCacheRef.current.get(cacheKey);
    if (cached) return cached;

    try {
      const data = prepareBrowserSpeech(trimmed, {
        gender: PRACTICE_VOICE_GENDER,
        rate: 0.9,
        pitch: 0.76
      });
      voiceCacheRef.current.set(cacheKey, data);
      return data;
    } catch {
      return null;
    }
  }, [voiceEnabled]);

  const playPracticeAudio = useCallback(async (message, data, requestId) => {
    if (!data || requestId !== voiceRequestIdRef.current) return;

    const playback = createBrowserAudio(data);
    if (!playback) return;

    const { audio, release } = playback;
    currentAudioRef.current = audio;

    await new Promise((resolve) => {
      const finish = () => {
        release();
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      playBrowserAudio(audio).catch(finish);
    });
  }, []);

  const playVoiceQueue = useCallback(async () => {
    if (isSpeakingRef.current || !voiceEnabled) return;

    const nextMessage = voiceQueueRef.current.shift();
    if (!nextMessage) return;

    const requestId = voiceRequestIdRef.current;
    isSpeakingRef.current = true;

    try {
      const data = await fetchPracticeVoice(nextMessage);
      await playPracticeAudio(nextMessage, data, requestId);
    } catch {
      // Voice is helpful in practice, but counting should continue without it.
    } finally {
      if (requestId === voiceRequestIdRef.current) {
        isSpeakingRef.current = false;
        if (voiceQueueRef.current.length) {
          playVoiceQueue();
        }
      }
    }
  }, [fetchPracticeVoice, playPracticeAudio, voiceEnabled]);

  const queuePracticeVoice = useCallback((message, { force = false, intent } = {}) => {
    const trimmed = message.trim();
    if (!voiceEnabled || !trimmed) return;

    const feedbackIntent = intent || getPracticeFeedbackIntent(trimmed);
    if (!force && feedbackIntent === lastPracticeSpokenIntentRef.current) return;

    lastPracticeSpokenIntentRef.current = feedbackIntent;
    // Keep the active sentence and replace any stale pending guidance with the
    // newest semantic instruction.
    voiceQueueRef.current = [trimmed];
    playVoiceQueue();
  }, [playVoiceQueue, voiceEnabled]);

  const stopPracticeVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  const sayPractice = useCallback((
    message,
    { force = false, intent, speak = true, log = true } = {}
  ) => {
    const feedbackIntent = intent || getPracticeFeedbackIntent(message);
    if (!force && feedbackIntent === lastPracticeFeedbackIntentRef.current) return;

    lastPracticeFeedbackIntentRef.current = feedbackIntent;
    setAssistantMessage(message);
    if (textEnabled && log) {
      appendConversation({ role: "ai", text: message });
    }
    if (voiceEnabled && speak) {
      queuePracticeVoice(message, { force, intent: feedbackIntent });
    }
  }, [appendConversation, queuePracticeVoice, textEnabled, voiceEnabled]);

  const selectTargetReps = useCallback((count) => {
    setTargetReps(count);
    sayPractice(
      `${count} reps selected. Choose the count gap, then start when ready.`,
      { intent: `set_config:${count}:${countGapMs}`, speak: false }
    );
  }, [countGapMs, sayPractice]);

  const selectCountGap = useCallback((gapMs) => {
    setCountGapMs(gapMs);
    sayPractice(
      `${formatCountGap(gapMs)} gap selected. Start when ready.`,
      { intent: `set_config:${targetReps}:${gapMs}`, speak: false }
    );
  }, [sayPractice, targetReps]);

  const postPracticeRep = useCallback(async (nextRep, repAccuracy, durationMs, focus, issue) => {
    const activeSession = sessionRef.current;
    const token = getAccessToken();
    if (!activeSession?.id || !token) return;

    const safeRepNumber = Number.isFinite(nextRep)
      ? Math.max(1, Math.round(nextRep))
      : 1;
    const safeAccuracy = Number.isFinite(repAccuracy)
      ? Math.max(0, Math.min(100, repAccuracy))
      : 0;
    const safeDurationMs = Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs))
      : 0;
    const qualityLabel = safeAccuracy >= CLEAN_ACCURACY ? "clean" : "shaky";
    try {
      const response = await authFetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/reps`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rep_number: safeRepNumber,
          accuracy: safeAccuracy,
          duration_ms: safeDurationMs,
          speed_label: speedLabel(safeDurationMs),
          quality_label: qualityLabel,
          focus_body_part: typeof focus === "string" ? focus : null,
          issue: typeof issue === "string" ? issue : null
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        console.error(
          `Practice rep ${safeRepNumber} could not be saved (${response.status}).`,
          detail
        );
        return;
      }

      const data = await response.json();
      const nextSession = isSetFinishingRef.current
        ? { ...data.session, status: "active" }
        : data.session;
      setSession(nextSession);
      sessionRef.current = nextSession;
    } catch {
      // Keep counting quiet; local rep state continues even if analysis storage misses a beat.
    }
  }, []);

  const completePracticeSession = useCallback(async (
    status = "completed",
    correctedSummary = null
  ) => {
    const activeSession = sessionRef.current;
    const token = getAccessToken();
    if (!activeSession?.id || !token) {
      if (activeSession) {
        const updatedSession = {
          ...activeSession,
          ...(correctedSummary || {}),
          status
        };
        sessionRef.current = updatedSession;
        setSession(updatedSession);
      }
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/complete`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status,
          corrected_summary: correctedSummary
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
        await loadPracticeAnalysis();
      } else {
        throw new Error(`Practice completion failed with ${response.status}`);
      }
    } catch {
      const updatedSession = {
        ...activeSession,
        ...(correctedSummary || {}),
        status
      };
      setSession(updatedSession);
      sessionRef.current = updatedSession;
      sayPractice("Set complete locally. Analysis storage did not update.");
    }
  }, [loadPracticeAnalysis, sayPractice]);

  const storePracticeTape = useCallback(async (sessionId, frames, metadata) => {
    const token = getAccessToken();
    if (!sessionId || !token || !frames.length) return false;

    try {
      const document = {
        version: 2,
        frame_rate: 30,
        duration_ms: Math.round(frames[frames.length - 1]?.elapsedMs || 0),
        frames: frames.map(encodePracticeTapeFrame),
        metadata: {
          ...metadata,
          algorithmVersion: metadata?.biomechanicsSchema || "unknown",
          configVersion: `frame-organization-v${metadata?.frameOrganizationVersion || 1}`,
          deviceGeneratedEstimate: true
        }
      };
      const serialized = JSON.stringify(document);
      const encoded = new TextEncoder().encode(serialized);
      const digest = await crypto.subtle.digest("SHA-256", encoded);
      const contentSha256 = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const idempotencyKey = crypto.randomUUID().replaceAll("-", "");
      const intentResponse = await authFetch(
        `${API_BASE_URL}/practice/sessions/${sessionId}/tape/upload-intent`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            version: document.version,
            frame_rate: document.frame_rate,
            frame_count: document.frames.length,
            duration_ms: document.duration_ms,
            content_length: encoded.byteLength,
            content_sha256: contentSha256,
            idempotency_key: idempotencyKey,
            schema_name: "practice-tape/v2",
            algorithm_version: document.metadata.algorithmVersion,
            config_version: document.metadata.configVersion
          })
        }
      );
      if (!intentResponse.ok) return false;
      const intent = await intentResponse.json();
      if (intent.already_stored) return true;

      if (intent.storage_mode === "azure") {
        const uploadResponse = await fetch(intent.upload_url, {
          method: "PUT",
          headers: intent.headers,
          body: serialized
        });
        if (!uploadResponse.ok) return false;
        const finalizeResponse = await authFetch(
          `${API_BASE_URL}/practice/sessions/${sessionId}/tape/finalize`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ idempotency_key: idempotencyKey })
          }
        );
        return finalizeResponse.ok;
      }

      const response = await authFetch(`${API_BASE_URL}/practice/sessions/${sessionId}/tape`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: serialized
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const clearCountBeatTimers = useCallback(() => {
    countBeatTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    countBeatTimersRef.current = [];
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordFrameRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
  }, []);

  const completeMovementRep = useCallback(async (repNumber, completedAt) => {
    if (
      completedMovementRepsRef.current.has(repNumber) ||
      sessionRef.current?.status !== "active"
    ) {
      return;
    }

    completedMovementRepsRef.current.add(repNumber);
    const repFrames = recordedFramesRef.current.filter((frame) => frame.rep === repNumber);
    const summary = buildRepTapeFromFrames(repFrames, steps)[0];
    const fallbackResult = latestPracticeResultRef.current;
    const durationMs = summary?.durationMs || Math.max(
      0,
      Math.round(completedAt - (repStartedAtRef.current || completedAt))
    );
    const repAccuracy = Number.isFinite(summary?.accuracy)
      ? summary.accuracy
      : Number.isFinite(fallbackResult?.accuracy)
        ? fallbackResult.accuracy
        : 0;
    const focus = summary?.focusBodyPart || fallbackResult.focusBodyPart;
    const issue = summary?.issue || fallbackResult.issue;
    const movementStartedAt = repFrames[0]?.elapsedMs ?? 0;

    repCountRef.current = repNumber;
    repStartedAtRef.current = completedAt;
    setRepCount(repNumber);
    setCleanReps((value) => value + (repAccuracy >= CLEAN_ACCURACY ? 1 : 0));
    setRepTape((entries) => [
      ...entries.filter((entry) => entry.rep !== repNumber),
      summary || {
        rep: repNumber,
        elapsedMs: movementStartedAt,
        durationMs,
        accuracy: repAccuracy,
        clean: repAccuracy >= CLEAN_ACCURACY,
        focusBodyPart: focus,
        issue,
        landmarks: latestLandmarksRef.current.map((point) => ({ ...point })),
        stepResults: steps.map((step, index) => ({
          step: index + 1,
          name: step?.step_name || `Step ${index + 1}`,
          accuracy: 0,
          captured: false,
          focusBodyPart: null,
          issue: "not_reached",
          landmarks: []
        }))
      }
    ].sort((left, right) => left.rep - right.rep));
    setTapeCursor(repNumber - 1);

    if (repNumber >= targetReps) {
      isSetFinishingRef.current = true;
    }
    await postPracticeRep(repNumber, repAccuracy, durationMs, focus, issue);
  }, [
    postPracticeRep,
    steps,
    targetReps
  ]);

  completeMovementRepRef.current = completeMovementRep;

  const runPracticeCountBeat = useCallback(async () => {
    if (
      sessionRef.current?.status !== "active" &&
      !isSetFinishingRef.current
    ) {
      return;
    }

    const nextCue = cueCountRef.current + 1;
    if (nextCue > targetReps) return;

    const countStartedAt = performance.now();
    cueCountRef.current = nextCue;
    countMarkersRef.current.push({
      cue: nextCue,
      elapsedMs: Math.round(countStartedAt - (setStartedAtRef.current || countStartedAt))
    });
    setCueCount(nextCue);
    setTemporalCue({ cue: nextCue, timestampMs: countStartedAt });
    setAssistantMessage(String(nextCue));
    if (textEnabled) {
      appendConversation({ role: "ai", text: String(nextCue) });
    }

    recoveryEndsAtRef.current = countStartedAt + countGapMs;
    setRecoveryRemainingMs(countGapMs);

    if (voiceEnabled) {
      playPracticeAudio(
        String(nextCue),
        numberAudioRef.current[nextCue - 1],
        voiceRequestIdRef.current
      );
    }
    if (nextCue < targetReps) {
      const intervalTimerId = window.setTimeout(() => {
        countBeatRef.current?.();
      }, countGapMs);
      countBeatTimersRef.current = [intervalTimerId];
    } else {
      const finalResponseTimerId = window.setTimeout(async () => {
        if (
          sessionRef.current?.status !== "active" &&
          !isSetFinishingRef.current
        ) {
          return;
        }

        isSetFinishingRef.current = true;
        recordFrameRef.current?.();
        const setStart = setStartedAtRef.current || performance.now();
        const tapeDurationMs = Math.max(0, Math.round(performance.now() - setStart));
        const analyzedTape = analyzePracticeTape({
          sourceFrames: recordedFramesRef.current,
          durationMs: tapeDurationMs,
          steps,
          targetReps,
          countMarkers: countMarkersRef.current,
          countGapMs
        });
        const correctedAnalysis = buildPracticeSessionAnalysis(analyzedTape, {
          steps,
          targetReps
        });
        const correctedSummary = buildPracticeSessionMetrics(
          correctedAnalysis,
          { cleanAccuracy: CLEAN_ACCURACY }
        );
        const correctedCompletedReps = correctedSummary.completed_reps;
        const completed = correctedCompletedReps >= targetReps;
        const remaining = Math.max(0, targetReps - correctedCompletedReps);
        repCountRef.current = correctedCompletedReps;
        setRepCount(correctedCompletedReps);
        setCleanReps(correctedSummary.clean_reps);
        setAccuracy(Math.round(correctedSummary.average_accuracy));
        const tapeMetadata = {
          sessionId: sessionRef.current?.id || null,
          targetReps,
          countGapMs,
          techniqueName: currentTechnique?.name || "Practice",
          biomechanicsSchema: "observed-filtered-measurement-aggregate-v2",
          postSessionClassification: true,
          frameOrganizationVersion: 2,
          clusteredCompletedReps:
            correctedCompletedReps,
          completionStatus: completed ? "completed" : "incomplete",
          completedReps: correctedCompletedReps,
          correctedSummary,
          captureWindow: {
            startedAt: "start_button",
            endedAfterFinalCueMs:
              countGapMs + PRACTICE_FINAL_ANALYSIS_GRACE_MS,
            countUsedForSegmentation: false
          },
          captureMarginsMs: {
            before: PRACTICE_PRE_ROLL_MS,
            after: PRACTICE_POST_ROLL_MS
          },
          steps: steps.map((step, index) => ({
            id: step?.id ?? index,
            step_name: step?.step_name || `Step ${index + 1}`
          }))
        };
        const activeSessionId = sessionRef.current?.id;
        clearCountBeatTimers();
        await completePracticeSession(
          completed ? "completed" : "cancelled",
          correctedSummary
        );
        const liveRuleEngineResult = await waitForRuleEngineResult();
        const trackingPackage = getTechniqueTrackingPackage(currentTechnique);
        const replayedRuleEngineResult = trackingPackage
          ? reanalyzePracticeTapeWithRuleEngine(analyzedTape, trackingPackage)
          : null;
        const ruleEngineResult =
          replayedRuleEngineResult || liveRuleEngineResult;
        const verifiedTape = ruleEngineResult
          ? attachRuleEngineAnalysisToTape(analyzedTape, ruleEngineResult)
          : analyzedTape;
        const verifiedMetadata = {
          ...tapeMetadata,
          authoritativeSession: sessionRef.current || null,
          ruleEngineAnalysis: ruleEngineResult?.ruleEngineAnalysis || null
        };
        if (analyzedTape.length) {
          setFullTapeFrames(verifiedTape);
          setAnalysisTapeMetadata(verifiedMetadata);
          setFullTapeCursor(0);
          setIsFullTapePlaying(false);
          setIsTapePopupExpanded(true);
          setIsTapePopupOpen(true);
          if (activeSessionId) {
            await storePracticeTape(activeSessionId, verifiedTape, verifiedMetadata);
            await loadPracticeAnalysis();
          }
        }
        const averageAccuracy = Math.round(correctedSummary.average_accuracy || 0);
        const cleanCount = correctedSummary.clean_reps || 0;
        const message = completed
          ? `Set finished. ${correctedCompletedReps} of ${targetReps} reps completed, ` +
            `${cleanCount} clean, with ${averageAccuracy} percent average accuracy. ` +
            "Your full session analysis is ready."
          : `Set ended. ${correctedCompletedReps} of ${targetReps} reps completed, ` +
            `${cleanCount} clean, with ${averageAccuracy} percent average accuracy. ` +
            `${remaining} ${remaining === 1 ? "rep was" : "reps were"} incomplete. ` +
            "Keep your body in view and try again.";
        setAssistantMessage(message);
        sayPractice(message, {
          force: true,
          intent: completed
            ? `set_finished:${targetReps}`
            : `set_incomplete:${correctedCompletedReps}:${targetReps}`,
          speak: true
        });
        isSetFinishingRef.current = false;
      }, countGapMs + PRACTICE_FINAL_ANALYSIS_GRACE_MS);
      countBeatTimersRef.current = [finalResponseTimerId];
    }
  }, [
    appendConversation,
    clearCountBeatTimers,
    completePracticeSession,
    countGapMs,
    currentTechnique,
    loadPracticeAnalysis,
    playPracticeAudio,
    sayPractice,
    steps,
    storePracticeTape,
    targetReps,
    textEnabled,
    waitForRuleEngineResult,
    voiceEnabled
  ]);

  countBeatRef.current = runPracticeCountBeat;

  const beginWholeSessionCapture = useCallback(() => {
    const captureStartedAt = performance.now();
    setStartedAtRef.current = captureStartedAt;
    repStartedAtRef.current = captureStartedAt;

    const recordFrame = () => {
      const now = performance.now();
      const holisticFrame = latestHolisticFrameRef.current;
      const landmarks = (
        holisticFrame.filteredPose?.length
          ? holisticFrame.filteredPose
          : latestLandmarksRef.current
      ).map((point) => ({ ...point }));
      const movementClassification = latestMovementClassificationRef.current;
      const poseMotion = getPoseMotion(
        previousRecordedLandmarksRef.current,
        landmarks
      );
      previousRecordedLandmarksRef.current = landmarks;
      recordedFramesRef.current.push({
        elapsedMs: now - captureStartedAt,
        sourceTimestampMs: holisticFrame.timestamp || now,
        rep: movementClassification.rep,
        step: movementClassification.step,
        phase: movementClassification.phase,
        temporalPhase: movementClassification.temporalPhase,
        stateConfidence: movementClassification.stateConfidence,
        trackingReliable: movementClassification.trackingReliable,
        scorable: movementClassification.scorable,
        accuracy: movementClassification.scorable
          ? latestPracticeResultRef.current.accuracy
          : null,
        focusBodyPart: movementClassification.scorable
          ? latestPracticeResultRef.current.focusBodyPart
          : null,
        issue: movementClassification.scorable
          ? latestPracticeResultRef.current.issue
          : "transition",
        wrongBodyParts: movementClassification.scorable
          ? [...(latestPracticeResultRef.current.wrongBodyParts || [])]
          : [],
        landmarks,
        observedLandmarks: (holisticFrame.observedPose || [])
          .map((point) => ({ ...point })),
        measurementLandmarks: (holisticFrame.measurementPose || [])
          .map((point) => ({ ...point })),
        angles: { ...(holisticFrame.angles || {}) },
        stepScores: [...(holisticFrame.stepScores || [])],
        trackingConfidence: holisticFrame.trackingConfidence ?? null,
        displayPoseSource: holisticFrame.displayPoseSource || "observed",
        facePoints: (holisticFrame.facePoints || [])
          .filter(
            (point) =>
              holisticFrame.faceSource === "pose33" ||
              TAPE_FACE_INDICES.has(point.index)
          )
          .map((point) => ({ ...point })),
        faceSource: holisticFrame.faceSource || "pose33",
        handPoints: Object.fromEntries(
          Object.entries(holisticFrame.handPoints || {}).map(([side, points]) => [
            side,
            points.map((point) => ({ ...point }))
          ])
        ),
        aggregateLandmarks: (
          holisticFrame.predictionAggregate?.aggregateLandmarks || []
        ).map((point) => point ? ({ ...point }) : point),
        predictionSourceCounts:
          holisticFrame.predictionAggregate?.sourceCounts || null,
        predictionAgreementError:
          holisticFrame.predictionAggregate?.agreementError ?? null,
        usedPredictionFallback:
          holisticFrame.predictionAggregate?.usePredictionFallback === true,
        predictionConfidence:
          holisticFrame.predictionAggregate?.predictionConfidence ?? null,
        forecastAwareness: holisticFrame.forecastAwareness
          ? {
              status: holisticFrame.forecastAwareness.status,
              trusted: holisticFrame.forecastAwareness.trusted === true,
              risk: holisticFrame.forecastAwareness.risk ?? 0,
              likely_mistake: holisticFrame.forecastAwareness.likely_mistake
                ? { ...holisticFrame.forecastAwareness.likely_mistake }
                : null,
              horizon_ms: holisticFrame.forecastAwareness.horizon_ms ?? null
            }
          : null,
        motionScore: Math.max(holisticFrame.motionEnergy || 0, poseMotion * 10)
      });
    };

    recordFrameRef.current = recordFrame;
    recordFrame();
    recordingTimerRef.current = window.setInterval(recordFrame, 1000 / 30);
    return captureStartedAt;
  }, []);

  const startPracticeForStep = useCallback(async (stepIndex = 0, { intro = true } = {}) => {
    if (!currentTechnique) return;

    if (attentionReminderTimerRef.current) {
      window.clearTimeout(attentionReminderTimerRef.current);
      attentionReminderTimerRef.current = null;
    }

    const startIndex = steps[stepIndex] ? stepIndex : 0;

    clearCountBeatTimers();
    stopPracticeVoice();
    const requestId = voiceRequestIdRef.current;
    const token = getAccessToken();
    sessionRef.current = LOCAL_SESSION;
    setSession(LOCAL_SESSION);
    setTemporalSessionId((sessionId) => sessionId + 1);
    setTemporalCue(null);
    setSelectedStepIndex(startIndex);
    setRepCount(0);
    setCueCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    ruleEngineResultRef.current = null;
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    countMarkersRef.current = [];
    previousRecordedLandmarksRef.current = [];
    repCountRef.current = 0;
    cueCountRef.current = 0;
    movementClassifierRef.current = createPracticeMovementClassifier({
      countStep:
        steps.findIndex((step) => step.counts_rep) >= 0
          ? steps.findIndex((step) => step.counts_rep) + 1
          : undefined,
      stepCount: steps.length,
      targetReps
    });
    latestMovementClassificationRef.current = {
      rep: 1,
      step: 1,
      phase: "transition",
      temporalPhase: "waiting_for_movement",
      stateConfidence: 0,
      trackingReliable: true,
      scorable: false
    };
    completedMovementRepsRef.current = new Set();
    isSetFinishingRef.current = false;
    setStartedAtRef.current = null;
    repStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(false);
    isReadyForRepRef.current = false;

    const setupIntent = `set_start:${targetReps}:${countGapMs}:${startIndex}`;
    const setupMessage = intro
      ? `${buildPracticeSetMessage({
          gapMs: countGapMs,
          reps: targetReps,
          started: true,
          stepName: steps[startIndex]?.step_name || currentTechnique.name
        })} Sequence: all ${steps.length} ${steps.length === 1 ? "step" : "steps"}. Start.`
      : `Step ${startIndex + 1}: ${steps[startIndex]?.step_name || "continue the movement"}. I will cue the rhythm; your movement completes each rep.`;
    sayPractice(setupMessage, { intent: setupIntent, speak: false });
    beginWholeSessionCapture();

    numberAudioRef.current = voiceEnabled
      ? await Promise.all(
          Array.from({ length: targetReps }, (_, index) =>
            fetchPracticeVoice(String(index + 1))
          )
        )
      : [];
    const setupAudio = voiceEnabled ? await fetchPracticeVoice(setupMessage) : null;
    if (voiceEnabled) {
      lastPracticeSpokenIntentRef.current = setupIntent;
      await playPracticeAudio(setupMessage, setupAudio, requestId);
    }
    if (requestId !== voiceRequestIdRef.current) {
      clearCountBeatTimers();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, PRACTICE_PRE_ROLL_MS));
    if (requestId !== voiceRequestIdRef.current) {
      clearCountBeatTimers();
      return;
    }
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    countBeatRef.current?.();

    if (!token) return;

    try {
      const response = await authFetch(`${API_BASE_URL}/practice/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          technique_name: currentTechnique.name,
          step_key: "full_sequence",
          step_name: `${currentTechnique.name}: ${steps
            .map((step) => step.step_name)
            .join(" → ")}`,
          target_reps: targetReps
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
      }
    } catch {
      sayPractice("Practice started locally. Analysis storage is offline.", {
        log: false
      });
    }
  }, [
    beginWholeSessionCapture,
    clearCountBeatTimers,
    countGapMs,
    currentTechnique,
    fetchPracticeVoice,
    playPracticeAudio,
    sayPractice,
    steps,
    stopPracticeVoice,
    targetReps,
    voiceEnabled
  ]);

  const startPractice = useCallback(() => {
    startPracticeForStep(0);
  }, [startPracticeForStep]);

  const resetPractice = useCallback(() => {
    completePracticeSession("cancelled");
    clearCountBeatTimers();
    stopPracticeVoice();
    setSession(null);
    sessionRef.current = null;
    setRepCount(0);
    setCueCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    ruleEngineResultRef.current = null;
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    countMarkersRef.current = [];
    previousRecordedLandmarksRef.current = [];
    repCountRef.current = 0;
    cueCountRef.current = 0;
    movementClassifierRef.current = null;
    latestMovementClassificationRef.current = {
      rep: 1,
      step: 1,
      phase: "transition",
      temporalPhase: "waiting_for_movement",
      stateConfidence: 0,
      trackingReliable: true,
      scorable: false
    };
    completedMovementRepsRef.current = new Set();
    isSetFinishingRef.current = false;
    numberAudioRef.current = [];
    setStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice("Reset. Choose a count and start when ready.", { force: true, speak: true });
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    stopPracticeVoice
  ]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopPracticeVoice();
    }
  }, [stopPracticeVoice, voiceEnabled]);

  const moveToPracticeStep = useCallback((nextIndex, { cancelSession = true } = {}) => {
    if (nextIndex < 0 || nextIndex >= steps.length) return false;
    if (cancelSession) {
      completePracticeSession("cancelled");
    }
    clearCountBeatTimers();
    setSession(null);
    sessionRef.current = null;
    setSelectedStepIndex(nextIndex);
    setRepCount(0);
    setCueCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    ruleEngineResultRef.current = null;
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    repCountRef.current = 0;
    cueCountRef.current = 0;
    movementClassifierRef.current = null;
    latestMovementClassificationRef.current = {
      rep: 1,
      step: nextIndex + 1,
      phase: "transition",
      temporalPhase: "waiting_for_movement",
      stateConfidence: 0,
      trackingReliable: true,
      scorable: false
    };
    completedMovementRepsRef.current = new Set();
    setStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice(`Step ${nextIndex + 1}. Are you ready to start?`, { speak: true });
    return true;
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    steps.length
  ]);

  const handlePracticeCommand = useCallback((message) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }

    const command = classifyPracticeCommand(trimmed);
    const activeSession = sessionRef.current?.status === "active";

    if (activeSession && command.intent === "set_count") {
      sayPractice("This set is active. Reset before changing the rep count.", {
        speak: true
      });
      return;
    }

    if (activeSession && command.intent === "start") {
      sayPractice("The set is already running. Continue your current rep, or say reset.", {
        speak: true
      });
      return;
    }

    if (activeSession && command.intent === "wait") {
      sayPractice("This set is active. Say reset if you need to stop and rebuild it.", {
        speak: true
      });
      return;
    }

    if (command.intent === "set_count") {
      setTargetReps(command.count);
      sayPractice(`Count set to ${command.count}. Say start when ready.`, {
        speak: true
      });
      return;
    }

    if (command.intent === "wait") {
      sayPractice("No rush. I will wait. Say start when you are ready.", { speak: true });
      return;
    }

    if (command.intent === "reset") {
      resetPractice();
      return;
    }

    if (command.intent === "start") {
      startPractice();
      return;
    }

    if (command.intent === "next") {
      if (!moveToPracticeStep(selectedStepIndex + 1)) {
        sayPractice("This is the last practice step. Practice again or view analysis.", {
          speak: true
        });
      }
      return;
    }

    if (command.intent === "previous") {
      if (!moveToPracticeStep(selectedStepIndex - 1)) {
        sayPractice("This is the first practice step.", { speak: true });
      }
      return;
    }

    if (command.intent === "train") {
      onModeChange?.("train");
      return;
    }

    if (command.intent === "analysis") {
      onModeChange?.("analysis");
      return;
    }

    sayPractice("Say start, reset, next step, train, analysis, or count 3, 5, or 10.");
  }, [
    appendConversation,
    moveToPracticeStep,
    onModeChange,
    resetPractice,
    sayPractice,
    selectedStepIndex,
    startPractice,
    textEnabled
  ]);

  const handleAngleUpdate = useCallback((liveAngles) => {
    const result = scorePracticeAngles(requiredParts, liveAngles);
    latestPracticeResultRef.current = result;
    setAccuracy(result.accuracy);
    setFocusBodyPart(result.focusBodyPart);
  }, [requiredParts]);

  const stopVoiceInput = useCallback((status = "Voice commands are off.") => {
    shouldListenRef.current = false;
    setIsListening(false);
    setVoiceInputStatus(status);

    if (restartListenTimerRef.current) {
      window.clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const startVoiceInput = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition || recognitionRef.current) {
      if (!SpeechRecognition) {
        setVoiceInputStatus("Voice commands are not supported in this browser.");
      }
      return;
    }

    shouldListenRef.current = true;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceInputStatus("Listening. Say start, reset, next, train, or analysis.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (shouldListenRef.current) {
        restartListenTimerRef.current = window.setTimeout(() => {
          startVoiceInputRef.current?.();
        }, 650);
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setIsListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setVoiceInputStatus("Microphone permission is blocked.");
        return;
      }
      setVoiceInputStatus("Voice command paused. Type or try again.");
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result?.isFinal) {
          finalTranscript += ` ${transcript}`;
        } else if (transcript.trim()) {
          setVoiceInputStatus(`Hearing: ${transcript.trim()}`);
        }
      }

      const command = finalTranscript.trim();
      if (command) {
        setVoiceInputStatus(`Command heard: ${command}`);
        finalTranscript = "";
        recognition.stop();
        handlePracticeCommand(command);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceInputStatus("Voice command could not start.");
    }
  }, [handlePracticeCommand]);

  useEffect(() => {
    startVoiceInputRef.current = startVoiceInput;
  }, [startVoiceInput]);

  useEffect(() => {
    if (!currentTechnique || greetedTechniqueRef.current === currentTechnique.name) {
      return;
    }

    greetedTechniqueRef.current = currentTechnique.name;
    const greeting = `Welcome to ${currentTechnique.name}. Set your reps and time gap, then start when ready.`;
    const greetingIntent = getPracticeFeedbackIntent(greeting);
    lastPracticeFeedbackIntentRef.current = greetingIntent;
    setAssistantMessage(greeting);
    setConversation([{ role: "ai", text: greeting }]);
  }, [currentTechnique]);

  useEffect(() => {
    if (attentionReminderTimerRef.current) {
      window.clearTimeout(attentionReminderTimerRef.current);
      attentionReminderTimerRef.current = null;
    }

    if (isPracticeActive || !currentTechnique) return undefined;

    attentionReminderTimerRef.current = window.setTimeout(() => {
      if (sessionRef.current?.status === "active") {
        attentionReminderTimerRef.current = null;
        return;
      }

      const reminder = session?.status === "completed"
        ? "Still with me? Choose practice again, training mode, or analysis."
        : "Still with me? Choose your reps, then say start when ready.";
      sayPractice(reminder, { speak: session?.status === "completed" });
      attentionReminderTimerRef.current = null;
    }, 15000);

    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
        attentionReminderTimerRef.current = null;
      }
    };
  }, [currentTechnique, isPracticeActive, sayPractice, session?.status]);

  useEffect(() => {
    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
      }
      clearCountBeatTimers();
      stopVoiceInput();
      stopPracticeVoice();
    };
  }, [clearCountBeatTimers, stopPracticeVoice, stopVoiceInput]);

  const openHistorySession = useCallback(async (historySession) => {
    if (
      historySession.id === analysisTapeMetadata?.sessionId &&
      fullTapeFrames.length
    ) {
      setIsTapePopupExpanded(true);
      setIsTapePopupOpen(true);
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setHistorySessionPopup(historySession);
      return;
    }

    try {
      const response = await authFetch(
        `${API_BASE_URL}/practice/sessions/${historySession.id}/tape`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        setHistorySessionPopup(historySession);
        return;
      }

      const data = await response.json();
      const restoredFrames = (data.frames || [])
        .map(decodePracticeTapeFrame)
        .sort((left, right) => left.elapsedMs - right.elapsedMs);
      if (!restoredFrames.length) {
        setHistorySessionPopup(historySession);
        return;
      }
      const restoredSteps = data.metadata?.steps || [];
      const savedRuleAnalysis = data.metadata?.ruleEngineAnalysis || null;
      const usesCurrentFrameOrganization =
        Number(data.metadata?.frameOrganizationVersion) >= 2;
      const trackingPackage = getTechniqueTrackingPackage(currentTechnique);
      const replayed = trackingPackage
        ? reanalyzePracticeTapeWithRuleEngine(restoredFrames, trackingPackage)
        : null;
      const displayedFrames = replayed?.frames || restoredFrames;
      const ruleEngineAnalysis =
        replayed?.ruleEngineAnalysis || savedRuleAnalysis || null;
      const authoritativeHistorySession = data.session || historySession;
      const correctedHistoryAnalysis = buildPracticeSessionAnalysis(
        displayedFrames,
        {
          steps: restoredSteps,
          targetReps: authoritativeHistorySession.target_reps
        }
      );
      const correctedHistorySummary = buildPracticeSessionMetrics(
        correctedHistoryAnalysis,
        { cleanAccuracy: CLEAN_ACCURACY }
      );
      let correctedHistorySession = authoritativeHistorySession;
      if (correctedHistorySummary.completed_reps > 0) {
        const correctionResponse = await authFetch(
          `${API_BASE_URL}/practice/sessions/${historySession.id}/complete`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              status:
                correctedHistorySummary.completed_reps >=
                authoritativeHistorySession.target_reps
                  ? "completed"
                  : "cancelled",
              corrected_summary: correctedHistorySummary
            })
          }
        );
        if (correctionResponse.ok) {
          correctedHistorySession = await correctionResponse.json();
          await loadPracticeAnalysis();
        }
      }
      setFullTapeFrames(displayedFrames);
      setAnalysisTapeMetadata({
        ...(data.metadata || {}),
        sessionId: historySession.id,
        analysisTrust: !usesCurrentFrameOrganization
          ? "legacy_trimmed"
          : replayed
            ? "post_session_reanalyzed"
            : savedRuleAnalysis || data.metadata?.postSessionClassification
              ? "post_session_verified"
              : "legacy_live",
        ruleEngineAnalysis,
        authoritativeSession: correctedHistorySession,
        repTape: buildRepTapeFromFrames(displayedFrames, restoredSteps)
      });
      setFullTapeCursor(0);
      setIsFullTapePlaying(false);
      setAnalysisCountFilter("all");
      setAnalysisStepFilter("all");
      setCameraRollZoom(3);
      setHistorySessionPopup(null);
      setIsTapePopupExpanded(true);
      setIsTapePopupOpen(true);
    } catch {
      setHistorySessionPopup(historySession);
    }
  }, [
    analysisTapeMetadata?.sessionId,
    currentTechnique,
    fullTapeFrames.length,
    loadPracticeAnalysis
  ]);

  if (!currentTechnique) {
    return (
      <aside className="practice-panel">
        <div className="panel-block">
          <p className="eyebrow">Practice Mode</p>
          <h1>No technique selected</h1>
          <p className="practice-copy">Open a technique before starting fixed-count practice.</p>
        </div>
      </aside>
    );
  }

  const overallKpi = practiceAnalysis?.summary;
  const latestSession = selectLatestPracticeSession(
    practiceAnalysis?.sessions
  );
  const sortedPracticeSessions = sortPracticeSessions(
    practiceAnalysis?.sessions,
    sessionSortDirection
  );

  return (
    <>
      <section
        className="training-stage training-stage--practice"
        aria-label="Practice mode camera tracking"
      >
        <SkeletonCanvas
          enableCoach={false}
          enableAwareness={false}
          performanceProfile={performanceProfile}
          performanceMode={performanceMode}
          inputSource={inputSource}
          inputVideoUrl={inputVideoUrl}
          inputVideoName={inputVideoName}
          onInputStatus={onInputStatus}
          onPredictionStatus={onPredictionStatus}
          displayMirrored={displayMirrored}
          skeletonLayers={practiceSkeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          currentStepId={selectedStep?.id}
          currentStepName={selectedStep?.step_name}
          sessionConfig={practiceSessionConfig}
          requiredParts={requiredParts}
          measurementParts={measurementParts}
          expectedParts={practiceFeedbackParts}
          feedbackParts={practiceFeedbackParts}
          onAngleUpdate={handleAngleUpdate}
          onLandmarkFrame={handleLandmarkFrame}
          temporalCue={temporalCue}
          temporalSessionId={temporalSessionId}
          trackingSessionActive={isPracticeActive}
          onLevel1Update={handleLevel1Update}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onRuleEngineFrameUpdate={
            isAdminStudio ? handleRuleEngineLiveFrame : undefined
          }
          onRuleEngineSessionComplete={handleRuleEngineSessionComplete}
          onAccuracyUpdate={() => {}}
          onFeedbackUpdate={() => {}}
          onSummaryUpdate={() => {}}
        />
        {isPracticeActive ? (
          <div className="practice-count-cue" role="status">
            <span>AI LEAD</span>
            <strong>{cueCount ? cueCount : "START"}</strong>
            <small>
              {getPracticeCuePrompt({
                cueCount,
                targetReps,
                repCount,
                recoveryRemainingMs,
                isReadyForRep
              })}
            </small>
          </div>
        ) : null}
      </section>

      <div
        aria-live={practiceNeedsReply ? "assertive" : "polite"}
        className={`feedback-banner feedback-banner--practice ${practiceNeedsReply ? "feedback-banner--attention" : ""}`}
      >
        <div className="feedback-banner__message" role={practiceNeedsReply ? "alert" : "status"}>
          <div className="master-status-row">
            <p className="eyebrow">Practice Guidance</p>
            <span className="master-status">
              {session?.status === "active"
                ? recoveryRemainingMs > 0 ? "Pacing" : "Counting"
                : session?.status === "completed" ? "Finished" : "Waiting"}
            </span>
            {focusBodyPart && session?.status !== "active" ? (
              <span className="master-focus">Focus: {formatBodyPart(focusBodyPart)}</span>
            ) : null}
          </div>
          <span>{textEnabled ? assistantMessage : "Text feedback is off."}</span>
        </div>
      </div>

      <aside className="practice-setup-panel practice-workspace-panel" aria-label="Practice workspace controls">
        <div className="panel-block practice-technique-card">
          <p className="eyebrow">Practice Mode</p>
          <h1>{currentTechnique.name}</h1>
          <p className="technique-meta">
            {currentTechnique.subcategory} / {currentTechnique.difficulty}
          </p>
        </div>

        <div className="panel-block practice-setup-summary">
          <div className="practice-setup-summary__top">
            <div>
              <p className="eyebrow">Set Builder</p>
              <h2>{session?.status === "completed" ? "Set complete" : isPracticeActive ? "Set in progress" : "Build your set"}</h2>
            </div>
            <span className={`practice-state ${isPracticeActive ? "practice-state--active" : ""}`}>
              {session?.status === "completed" ? "Complete" : isPracticeActive ? "Live" : "Ready"}
            </span>
          </div>
          <p>
            {isPracticeActive
              ? `${Math.max(targetReps - repCount, 0)} movement reps remaining. Cues set the rhythm; form and completion are measured separately.`
              : "Choose a rep target and cue gap. Movement completes reps; cue timing does not affect form accuracy."}
          </p>
        </div>

        <StepEvidenceGuide step={selectedStep} />

        <div className="panel-block practice-controls">
          <div className="practice-control-heading">
            <p className="eyebrow">Repetitions</p>
            <span>{targetReps} total</span>
          </div>
          <div className="rep-count-options">
            {COUNT_OPTIONS.map((count) => (
              <button
                aria-pressed={count === targetReps}
                className={count === targetReps ? "is-active" : ""}
                disabled={isPracticeActive}
                key={count}
                onClick={() => selectTargetReps(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
          <label className="practice-range-control">
            <span className="practice-range-control__header">
              <span>Custom repetitions</span>
              <output>{targetReps} reps</output>
            </span>
            <input
              aria-label="Custom repetition target"
              disabled={isPracticeActive}
              max="50"
              min="1"
              onChange={(event) => {
                const nextCount = Math.max(1, Math.min(50, Number(event.target.value) || 1));
                selectTargetReps(nextCount);
              }}
              step="1"
              type="range"
              value={targetReps}
            />
            <span className="practice-range-control__scale" aria-hidden="true">
              <span>1</span>
              <span>50 reps</span>
            </span>
          </label>
          <div className="practice-control-heading">
            <p className="eyebrow">Count gap</p>
            <span>{formatCountGap(countGapMs)}</span>
          </div>
          <div className="rep-count-options">
            {GAP_OPTIONS.map((gap) => (
              <button
                aria-pressed={gap.value === countGapMs}
                className={gap.value === countGapMs ? "is-active" : ""}
                disabled={isPracticeActive}
                key={gap.value}
                onClick={() => selectCountGap(gap.value)}
                type="button"
              >
                {gap.label}
              </button>
            ))}
          </div>
          <label className="practice-range-control">
            <span className="practice-range-control__header">
              <span>Custom count gap</span>
              <output>{formatCountGap(countGapMs)}</output>
            </span>
            <input
              aria-label="Custom count gap"
              disabled={isPracticeActive}
              max="5000"
              min="500"
              onChange={(event) => {
                const nextGapMs = Math.max(500, Math.min(5000, Number(event.target.value) || 500));
                selectCountGap(nextGapMs);
              }}
              step="100"
              type="range"
              value={countGapMs}
            />
            <span className="practice-range-control__scale" aria-hidden="true">
              <span>0.5s</span>
              <span>5s</span>
            </span>
          </label>
          <div className="practice-actions">
            <button className="btn btn--light" disabled={isPracticeActive} onClick={startPractice} type="button">
              {isPracticeActive ? "Set running" : session?.status === "completed" ? "Start again" : "Start set"}
            </button>
            <button className="btn btn--ghost" onClick={resetPractice} type="button">
              {isPracticeActive ? "Stop set" : "Reset"}
            </button>
          </div>
        </div>

        <div className="practice-stats practice-stats--side">
          <div>
            <span>Reps</span>
            <strong>{repCount}/{targetReps}</strong>
          </div>
          <div>
            <span>Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div>
            <span>Clean</span>
            <strong>{cleanReps}</strong>
          </div>
          <div>
            <span>Focus</span>
            <strong>{formatBodyPart(focusBodyPart)}</strong>
          </div>
          <div>
            <span>Step scan</span>
            <strong>{isReadyForRep ? `Step ${selectedStepIndex + 1}` : "Advancing"}</strong>
          </div>
        </div>

        <div className="panel-block practice-last-session">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Latest {currentTechnique.name} session</p>
              <strong>
                {latestSession?.technique_name || "No recorded session"}
              </strong>
            </div>
            {latestSession ? (
              <button
                aria-label={`Expand ${latestSession.technique_name} session summary`}
                onClick={() => openHistorySession(latestSession)}
                type="button"
              >
                Expand
              </button>
            ) : null}
          </div>
          {latestSession ? (
            <>
              <time dateTime={latestSession.ended_at || latestSession.started_at || undefined}>
                {formatSessionTimestamp(latestSession.ended_at || latestSession.started_at)}
              </time>
              <div className="practice-last-session__metrics">
                <span><small>Reps</small><strong>{latestSession.completed_reps}/{latestSession.target_reps}</strong></span>
                <span><small>Average</small><strong>{latestSession.average_accuracy}%</strong></span>
                <span><small>Clean</small><strong>{latestSession.clean_reps}</strong></span>
                <span><small>Consistency</small><strong>{latestSession.consistency_score}%</strong></span>
              </div>
            </>
          ) : (
            <p className="empty-state">Your latest recorded set will appear here.</p>
          )}
        </div>

      </aside>

      <aside className="training-panel training-panel--right practice-analysis-panel" aria-label="Practice analysis">
        <div className="panel-block practice-analysis-heading">
          <p className="eyebrow">Practice Analysis</p>
          <h2>{session?.status === "completed" ? "Set performance" : "Performance overview"}</h2>
          <p>
            {session?.status === "completed"
              ? "The tape is saved below your set controls. Review overall form and the recommended next action here."
              : "Accuracy is measured for analysis while the AI keeps the selected counting rhythm."}
          </p>
        </div>

        {isAdminStudio ? (
          <>
            <div className="panel-block">
              <AdminPracticeDiagnostics
                ruleFrame={ruleEngineLiveFrame}
                level2State={level2State}
                level3State={level3State}
                situationAwarenessState={situationAwarenessState}
                events={ruleEngineLiveEvents}
                onClearEvents={() => setRuleEngineLiveEvents([])}
              />
            </div>
            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showAdvancedAnalysis}
                className="advanced-analysis-button"
                onClick={() => setShowAdvancedAnalysis((isVisible) => !isVisible)}
                type="button"
              >
                Advanced Analysis
                <span>{showAdvancedAnalysis ? "Hide" : "Expand"}</span>
              </button>
              {showAdvancedAnalysis ? (
                <>
                  <ActionSkeletonOverlay level2State={level2State} variant="panel" />
                  <Level1DebugPanel state={level1State} />
                  <Level2DebugPanel state={level2State} />
                </>
              ) : null}
            </div>

            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showDataLayers}
                className="advanced-analysis-button"
                onClick={() => setShowDataLayers((isVisible) => !isVisible)}
                type="button"
              >
                Data Layers
                <span>{showDataLayers ? "Hide" : "Expand"}</span>
              </button>
              {showDataLayers ? (
                <DataLayersPanel
                  level1State={level1State}
                  level2State={level2State}
                  level3State={level3State}
                  level4State={level4State}
                  situationAwarenessState={situationAwarenessState}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <div className="panel-block practice-kpi-card">
          <div className="panel-heading">
            <p className="eyebrow">Overall KPI</p>
            <span>{currentTechnique.name} · last 12 sets</span>
          </div>
          <div className="practice-kpi-grid">
            <div><span>Avg form</span><strong>{overallKpi ? `${overallKpi.average_accuracy}%` : "--"}</strong></div>
            <div><span>Clean rate</span><strong>{overallKpi ? `${overallKpi.clean_rate}%` : "--"}</strong></div>
            <div><span>Consistency</span><strong>{overallKpi ? `${overallKpi.consistency_score}%` : "--"}</strong></div>
            <div><span>Total reps</span><strong>{overallKpi?.total_reps ?? "--"}</strong></div>
          </div>
        </div>

        <div className="panel-block practice-session-history">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Session history</p>
              <strong>{currentTechnique.name} only · sorted by timestamp</strong>
            </div>
            <button
              aria-label={`Sort sessions ${sessionSortDirection === "desc" ? "oldest first" : "newest first"}`}
              onClick={() =>
                setSessionSortDirection((direction) =>
                  direction === "desc" ? "asc" : "desc"
                )
              }
              type="button"
            >
              {sessionSortDirection === "desc" ? "Newest ↓" : "Oldest ↑"}
            </button>
          </div>
          {sortedPracticeSessions.length ? (
            <div className="practice-session-history__list">
              {sortedPracticeSessions.map((historySession) => {
                const timestamp = historySession.ended_at || historySession.started_at;
                return (
                  <article
                    key={`practice-history-${historySession.id}`}
                  >
                    <button
                      aria-label={`Open ${historySession.technique_name} session from ${formatSessionTimestamp(timestamp)}`}
                      className="practice-session-history__summary"
                      onClick={() => openHistorySession(historySession)}
                      type="button"
                    >
                      <span>
                        <strong>{historySession.technique_name}</strong>
                        <time dateTime={timestamp || undefined}>
                          {formatSessionTimestamp(timestamp)}
                        </time>
                        <small>
                          {historySession.completed_reps}/
                          {historySession.target_reps} reps ·{" "}
                          {historySession.completed_reps >=
                          historySession.target_reps
                            ? "Completed"
                            : "Incomplete"}
                        </small>
                      </span>
                      <span>
                        <strong>{historySession.average_accuracy}%</strong>
                        <i>↗</i>
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">Recorded sessions will appear here by timestamp.</p>
          )}
        </div>

        <div className="panel-block coach-card practice-analysis-action">
          <p className="eyebrow">Next action</p>
          <strong>
            {session?.status === "completed"
              ? "Review this set while the movement is still fresh."
              : overallKpi?.recommendation || "Complete a set to unlock your recommendation."}
          </strong>
          <button
            className="btn btn--light btn--full"
            onClick={() => onModeChange?.("analysis")}
            type="button"
          >
            Open full analysis
          </button>
        </div>
      </aside>

      <aside className="conversation-crate conversation-crate--practice" aria-label="Talk to practice assistant">
        <div className="conversation-crate__header">
          <div>
            <p className="eyebrow">Student Reply</p>
            <strong>{isListening ? "Listening" : voiceInputStatus}</strong>
          </div>
          <button
            className="conversation-listen"
            onClick={isListening ? stopVoiceInput : startVoiceInput}
            type="button"
          >
            {isListening ? "Stop" : "Listen"}
          </button>
          {conversation.length > 2 ? (
            <button
              aria-expanded={showConversationHistory}
              className="conversation-history-toggle"
              onClick={() => setShowConversationHistory((visible) => !visible)}
              type="button"
            >
              {showConversationHistory ? "Latest only" : `History (${conversation.length})`}
            </button>
          ) : null}
        </div>

        <div className="conversation-log">
          {!textEnabled ? (
            <p className="conversation-empty">Text coach is off.</p>
          ) : (
            conversation.slice(showConversationHistory ? -6 : -2).map((item, index) => (
              <p
                className={`conversation-line conversation-line--${item.role}`}
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>{item.role === "ai" ? "Practice Coach" : "You"}</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          {textEnabled && practiceNeedsReply ? (
            <div className="quick-replies" aria-label="Suggested practice replies">
              {practiceReplyOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePracticeCommand(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="coach-command"
            onSubmit={(event) => {
              event.preventDefault();
              handlePracticeCommand(practiceInput);
              setPracticeInput("");
            }}
          >
            <input
              aria-label="Talk to practice assistant"
              onChange={(event) => setPracticeInput(event.target.value)}
              placeholder="Say start, reset, next..."
              value={practiceInput}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </aside>

      {isTapePopupOpen && fullTapeFrames.length ? (
        <section
          aria-label="Full 30 FPS movement tape"
          aria-modal="true"
          className={`practice-tape-popup ${isTapePopupExpanded ? "is-expanded" : "is-compact"} ${isCameraRollExpanded ? "is-sequence-expanded" : ""} ${showRawFrameInspector ? "is-raw-visible" : "is-raw-hidden"}`}
          role="dialog"
        >
          <div className="practice-tape-popup__header">
            <div>
              <p className="eyebrow">Full session analysis</p>
              <strong>
                {displayedCompletedReps}/{tapeTargetReps} reps ·{" "}
                {formatTapeTime(fullTapeDurationMs)}
              </strong>
              <small>Device-generated coaching estimate — not an independently validated performance score.</small>
            </div>
            <div>
              <button
                onClick={() => setIsTapePopupExpanded((expanded) => !expanded)}
                type="button"
              >
                {isTapePopupExpanded ? "Collapse" : "Expand"}
              </button>
              <button
                onClick={() => {
                  setIsFullTapePlaying(false);
                  setIsTapePopupOpen(false);
                }}
                type="button"
              >
                Hide
              </button>
            </div>
          </div>

          {isAdminStudio ? (
            <div className="practice-tape-popup__notices">
            {analysisTapeMetadata?.analysisTrust === "legacy_live" ? (
              <div className="practice-session-analysis__finding is-warning" role="status">
                <span>Legacy session</span>
                <strong>
                  Frame labels were captured live before full-session verification was available.
                  Treat step boundaries and cue timing as estimates.
                </strong>
              </div>
            ) : null}

            {analysisTapeMetadata?.analysisTrust === "legacy_trimmed" ? (
              <div className="practice-session-analysis__finding is-warning" role="status">
                <span>Earlier frame organization</span>
                <strong>
                  This stored tape may begin inside a repetition because its discarded
                  source frames cannot be recovered. Record a new set to use the corrected
                  preparation, Step 1, Step 2, and recovery boundaries.
                </strong>
              </div>
            ) : null}

            {analysisTapeMetadata?.analysisTrust === "post_session_reanalyzed" ? (
              <div className="practice-session-analysis__finding" role="status">
                <span>Legacy tape reanalyzed</span>
                <strong>
                  This saved session was replayed through the current temporal rule engine.
                  Rule steps, repetition boundaries, and completion counts below are corrected.
                </strong>
              </div>
            ) : null}

            {analysisTapeMetadata?.ruleEngineAnalysis ? (
              <div className="practice-session-analysis__finding" role="status">
                <span>Sequence cluster and strict verification</span>
                <strong>
                  Tape cluster: {displayedCompletedReps} completed. Strict rules:{" "}
                  {analysisTapeMetadata.ruleEngineAnalysis.summary.completed_repetitions} verified,
                  {" "}
                  {analysisTapeMetadata.ruleEngineAnalysis.summary.aborted_repetitions} incomplete,
                  {" "}
                  {analysisTapeMetadata.ruleEngineAnalysis.summary.corrections_applied} timeline corrections
                </strong>
              </div>
            ) : null}
            </div>
          ) : null}

          <PracticeAccuracyTimeline
            countFilter={analysisCountFilter}
            contentWidth={timelineContentWidth}
            expanded={isCameraRollExpanded}
            frames={analysisTapeFrames}
            onScroll={(event) =>
              syncTimelineScroll(event.currentTarget, cameraRollScrollRef)
            }
            onSelectFrame={(frameIndex) => {
              setIsFullTapePlaying(false);
              setFullTapeCursor(frameIndex);
            }}
            scrollRef={accuracyTimelineScrollRef}
            selectedFrame={fullTapeCursor}
            stepFilter={analysisStepFilter}
          />

          <div className="practice-session-analysis">
            <div className="practice-session-analysis__frame">
              <div className="practice-selected-frame__heading">
                <div>
                  <p className="eyebrow">Selected frame</p>
                  <strong>Frame {fullTapeCursor + 1}</strong>
                </div>
                <span className={!fullTapeFrameScorable ? "is-transition" : fullTapeFrameNeedsReview ? "is-review" : "is-clean"}>
                  {!fullTapeFrameScorable
                    ? formatTemporalPhase(fullTapeFrame?.temporalPhase)
                    : fullTapeFrameNeedsReview
                      ? "Review"
                      : "Clean"}
                </span>
              </div>
              <TapeSkeleton
                highlightBodyPart={
                  fullTapeFrameNeedsReview
                    ? fullTapeFrame?.focusBodyPart
                    : null
                }
                highlightBodyParts={
                  fullTapeFrameNeedsReview
                    ? fullTapeFrame?.wrongBodyParts
                    : []
                }
                landmarks={fullTapeFrame?.landmarks}
                mirrored={displayMirrored}
              />
              <div className="practice-selected-frame__tracking">
                <span>
                  <LandmarkDetailSkeleton
                    kind="face"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.facePoints}
                  />
                  <small>Face</small>
                  <strong>{fullTapeFrame?.faceSource === "mesh" ? "Mesh tracked" : "Pose 33"}</strong>
                </span>
                <span>
                  <LandmarkDetailSkeleton
                    kind="hand"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.handPoints?.left}
                  />
                  <small>Left hand</small>
                  <strong>
                    {formatFistAnalysis(
                      fullTapeFrame?.angles?.fist_left,
                      fullTapeFrame?.handPoints?.left?.length || 0
                    )}
                  </strong>
                </span>
                <span>
                  <LandmarkDetailSkeleton
                    kind="hand"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.handPoints?.right}
                  />
                  <small>Right hand</small>
                  <strong>
                    {formatFistAnalysis(
                      fullTapeFrame?.angles?.fist_right,
                      fullTapeFrame?.handPoints?.right?.length || 0
                    )}
                  </strong>
                </span>
              </div>
            </div>

            <div className="practice-session-analysis__details">
              <p className="eyebrow">
                {isAdminStudio ? "Frame and sequence analytics" : "Movement details"}
              </p>
              <h3>
                {isAdminStudio
                  ? "Timestamp, rep, form and cue attention"
                  : "Selected moment"}
              </h3>
              <div className="practice-session-analysis__frame-meta">
                <span><small>Timestamp</small><strong>{formatTapeTime(fullTapeFrame?.elapsedMs || 0)}</strong></span>
                <span>
                  <small>Rep</small>
                  <strong>
                    {fullTapeFrameIsPreparation
                      ? "Preparation"
                      : displayedFrameRep || "--"}
                  </strong>
                </span>
                <span>
                  <small>Step</small>
                  <strong>
                    {fullTapeFrameIsPreparation
                      ? "Preparation"
                      : fullTapeFrame?.phase === "transition"
                      ? `Transition to ${fullTapeFrame?.step || "--"}`
                      : fullTapeFrame?.step || "--"}
                  </strong>
                </span>
                <span>
                  <small>Sequence phase</small>
                  <strong>
                    {fullTapeFrameIsPreparation
                      ? "Waiting For Movement"
                      : formatTemporalPhase(fullTapeFrame?.temporalPhase)}
                  </strong>
                </span>
                {isAdminStudio ? (
                  <>
                    <span>
                      <small>Classifier confidence</small>
                      <strong>
                        {Number.isFinite(fullTapeFrame?.stateConfidence)
                          ? `${fullTapeFrame.stateConfidence}%`
                          : "--"}
                      </strong>
                    </span>
                <span>
                  <small>Prediction aggregate</small>
                  <strong>
                    {fullTapeFrame?.predictionSourceCounts
                      ? `Live ${fullTapeFrame.predictionSourceCounts.observed} · L1 ${fullTapeFrame.predictionSourceCounts.level1} · L2 ${fullTapeFrame.predictionSourceCounts.level2}`
                      : "Live only"}
                  </strong>
                </span>
                <span>
                  <small>Biomechanics streams</small>
                  <strong>
                    {fullTapeFrame?.measurementLandmarks?.length
                      ? "Observed · Filtered · World · Aggregate"
                      : "Legacy filtered pose"}
                  </strong>
                </span>
                <span>
                  <small>Sequence analysis</small>
                  <strong>
                    {fullTapeFrame?.postSessionClassified
                      ? "Full-session verified"
                      : "Live classification"}
                  </strong>
                </span>
                <span>
                  <small>Session state</small>
                  <strong>{formatBodyPart(correctedFrameState?.session_state) || "--"}</strong>
                </span>
                <span>
                  <small>Rep state</small>
                  <strong>
                    {correctedFrameState?.rep_id
                      ? `Rep ${correctedFrameState.rep_id} · ${formatBodyPart(correctedFrameState.rep_state)}`
                      : formatBodyPart(correctedFrameState?.rep_state) || "Waiting"}
                  </strong>
                </span>
                <span>
                  <small>Rule step</small>
                  <strong>
                    {correctedFrameState?.step
                      ? formatBodyPart(correctedFrameState.step)
                      : "--"}
                  </strong>
                </span>
                <span>
                  <small>Rule phase</small>
                  <strong>
                    {correctedFrameState?.phase
                      ? formatBodyPart(correctedFrameState.phase)
                      : "--"}
                  </strong>
                </span>
                <span>
                  <small>Rule confidence</small>
                  <strong>
                    {Number.isFinite(correctedFrameState?.confidence)
                      ? `${Math.round(correctedFrameState.confidence * 100)}%`
                      : "--"}
                  </strong>
                </span>
                    <span>
                      <small>Correction status</small>
                      <strong>
                        {fullTapeFrame?.ruleEngineAnalysis?.changed
                          ? "Corrected after session"
                          : correctedFrameState
                            ? "Confirmed"
                            : "Unavailable"}
                      </strong>
                    </span>
                  </>
                ) : null}
                <span>
                  <small>Accuracy</small>
                  <strong>
                    {Number.isFinite(fullTapeFrame?.accuracy)
                      ? `${fullTapeFrame.accuracy}%`
                      : "Not scored"}
                  </strong>
                </span>
                {isAdminStudio ? (
                  <>
                    <span>
                      <small>Count cue</small>
                      <strong className={`is-${fullTapeFrame?.attentionTiming || "no-response"}`}>
                        {fullTapeFrame?.attentionTiming === "on-time"
                          ? "On time"
                          : formatBodyPart(fullTapeFrame?.attentionTiming)}
                      </strong>
                    </span>
                    <span>
                      <small>Response offset</small>
                      <strong>{formatAttentionOffset(fullTapeFrame?.attentionOffsetMs)}</strong>
                    </span>
                  </>
                ) : null}
              </div>
              <div className={`practice-session-analysis__finding ${!fullTapeFrameScorable ? "is-transition" : fullTapeFrameNeedsReview ? "is-warning" : "is-clean"}`}>
                <span>
                  {correctedFrameState?.tracking_lost
                    ? "Tracking lost"
                    : correctedFrameState?.unknown_movement
                      ? "Unknown movement"
                      : fullTapeFrameIsPreparation
                        ? "Preparation"
                      : !fullTapeFrameScorable
                        ? formatTemporalPhase(fullTapeFrame?.temporalPhase)
                        : fullTapeFrameNeedsReview
                          ? "Needs review"
                          : "Clean frame"}
                </span>
                <strong>
                  {correctedFrameState?.tracking_lost
                    ? "This interval was excluded from state changes and form scoring"
                    : correctedFrameState?.unknown_movement
                      ? "Movement evidence did not satisfy a valid ordered transition"
                    : correctedFrameState?.rejected_transition
                        ? "An impossible transition was rejected during post-session correction"
                    : fullTapeFrameIsPreparation
                    ? "Waiting for the first confirmed ordered movement"
                    : !fullTapeFrameScorable
                    ? fullTapeFrame?.trackingReliable === false
                      ? "Tracking was unreliable, so this frame did not change the sequence"
                      : "Temporal movement frames are preserved but excluded from form accuracy"
                    : fullTapeFrameRuleErrors.length
                    ? fullTapeFrameRuleErrors
                        .map((errorId) => formatBodyPart(errorId))
                        .join(" · ")
                    : fullTapeFrameNeedsReview && fullTapeFrame?.focusBodyPart
                    ? `${formatBodyPart(fullTapeFrame.focusBodyPart)} · ${formatBodyPart(fullTapeFrame.issue)}`
                    : "Target angles are within range"}
                </strong>
              </div>

              <p className="eyebrow">Full session</p>
              <div className="practice-session-analysis__summary">
                <span><small>Average</small><strong>{displayedSessionAverage}%</strong></span>
                <span><small>Review frames</small><strong>{fullTapeReviewFrames}</strong></span>
                <span><small>Reps</small><strong>{displayedCompletedReps}/{tapeTargetReps}</strong></span>
                <span><small>Consistency</small><strong>{sequenceConsistency}%</strong></span>
              </div>
              <div className="practice-session-analysis__recommendation">
                <span>AI recommendation</span>
                <strong>{fullTapeRecommendation}</strong>
              </div>
              <div className="practice-session-analysis__legend" aria-label="Skeleton analysis legend">
                <span><i className="is-correct" /> Correct bone</span>
                <span><i className="is-wrong" /> Incorrect angle</span>
              </div>
            </div>
          </div>

          <div className="practice-tape-popup__controls">
            <button
              aria-label="Previous frame"
              onClick={() => {
                setIsFullTapePlaying(false);
                const position = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                const previous = filteredTapeFrames[Math.max(0, position - 1)];
                if (previous) setFullTapeCursor(previous.index);
              }}
              type="button"
            >
              −1f
            </button>
            <button
              onClick={() => {
                const filteredPosition = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                if (
                  !isFullTapePlaying &&
                  filteredTapeFrames.length &&
                  (filteredPosition < 0 || filteredPosition >= filteredTapeFrames.length - 1)
                ) {
                  setFullTapeCursor(filteredTapeFrames[0].index);
                }
                setIsFullTapePlaying((playing) => !playing);
              }}
              type="button"
            >
              {isFullTapePlaying ? "Pause" : "Play 30 FPS"}
            </button>
            <input
              aria-label="Scrub full movement tape"
              max={Math.max(filteredTapeFrames.length - 1, 0)}
              min="0"
              onChange={(event) => {
                setIsFullTapePlaying(false);
                const selectedFrame = filteredTapeFrames[Number(event.target.value)];
                if (selectedFrame) setFullTapeCursor(selectedFrame.index);
              }}
              step="1"
              type="range"
              value={filteredTapeCursorPosition}
            />
            <button
              aria-label="Next frame"
              onClick={() => {
                setIsFullTapePlaying(false);
                const position = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                const next = filteredTapeFrames[
                  Math.min(filteredTapeFrames.length - 1, Math.max(0, position + 1))
                ];
                if (next) setFullTapeCursor(next.index);
              }}
              type="button"
            >
              +1f
            </button>
            <span>{filteredTapeCursorPosition + 1}/{filteredTapeFrames.length}</span>
          </div>

          <div className="practice-camera-roll-heading">
            <div>
              <PracticeSessionMap
                analysis={canonicalSessionAnalysis}
                onSelectFrame={(frameIndex) => {
                  setIsFullTapePlaying(false);
                  setFullTapeCursor(frameIndex);
                }}
                selectedFrame={fullTapeCursor}
              />
              <div className="practice-camera-roll-filters">
                <label>
                  <span>Rep</span>
                  <select
                    onChange={(event) => {
                      const nextFilter = event.target.value;
                      setAnalysisCountFilter(nextFilter);
                      const matchIndex = analysisTapeFrames.findIndex(
                        (frame) =>
                          (
                            nextFilter === "all" ||
                            frame.analysisRep === Number(nextFilter)
                          ) &&
                          (analysisStepFilter === "all" || frame.step === Number(analysisStepFilter))
                      );
                      if (matchIndex >= 0) setFullTapeCursor(matchIndex);
                    }}
                    value={analysisCountFilter}
                  >
                    <option value="all">All reps</option>
                    {tapeRepFilterOptions.map((rep) => (
                      <option key={`count-filter-${rep}`} value={rep}>
                        Rep {rep}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Step</span>
                  <select
                    onChange={(event) => {
                      const nextFilter = event.target.value;
                      setAnalysisStepFilter(nextFilter);
                      const matchIndex = analysisTapeFrames.findIndex(
                        (frame) =>
                          (
                            analysisCountFilter === "all" ||
                            frame.analysisRep === Number(analysisCountFilter)
                          ) &&
                          (nextFilter === "all" || frame.step === Number(nextFilter))
                      );
                      if (matchIndex >= 0) setFullTapeCursor(matchIndex);
                    }}
                    value={analysisStepFilter}
                  >
                    <option value="all">All steps</option>
                    {tapeAnalysisSteps.map((step, index) => (
                      <option key={`step-filter-${step.id ?? index}`} value={index + 1}>
                        Step {index + 1} · {step.step_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {isAdminStudio ? (
              <div className="practice-camera-roll-tools">
              <button
                aria-expanded={showRawFrameInspector}
                onClick={() => setShowRawFrameInspector((visible) => !visible)}
                type="button"
              >
                {showRawFrameInspector ? "Hide raw frames" : "Inspect raw frames"}
              </button>
              <span>{filteredTapeFrames.length}/{fullTapeFrames.length} frames</span>
              <button
                aria-label="Compress timeline"
                disabled={cameraRollZoom <= .75}
                onClick={() =>
                  setCameraRollZoom((zoom) =>
                    Math.max(.75, Math.round((zoom / 1.5) * 100) / 100)
                  )
                }
                type="button"
              >
                −
              </button>
              <span>{cameraRollFrameWidth < 10 ? cameraRollFrameWidth.toFixed(2) : Math.round(cameraRollFrameWidth)} px/frame</span>
              <button
                aria-label="Expand timeline"
                disabled={cameraRollZoom >= 120}
                onClick={() =>
                  setCameraRollZoom((zoom) =>
                    Math.min(120, Math.round(zoom * 1.5 * 100) / 100)
                  )
                }
                type="button"
              >
                +
              </button>
              <button
                onClick={() => setIsCameraRollExpanded((expanded) => !expanded)}
                type="button"
              >
                {isCameraRollExpanded ? "Compact sequence + chart" : "Expand sequence + chart"}
              </button>
              </div>
            ) : null}
          </div>

          <div
            aria-label="All skeleton frames"
            className={`practice-camera-roll ${isCameraRollExpanded ? "is-expanded" : ""} ${cameraRollFrameWidth < 24 ? "is-compressed" : ""}`}
            onScroll={
              hasActiveTapeFilter
                ? undefined
                : (event) =>
                    syncTimelineScroll(event.currentTarget, accuracyTimelineScrollRef)
            }
            ref={cameraRollScrollRef}
            style={{
              "--camera-roll-frame-width": `${cameraRollFrameWidth}px`,
              "--timeline-content-width": `${cameraRollContentWidth}px`
            }}
          >
            {filteredTapeFrames.map(({ frame, index }) => {
              const frameIsPreparation =
                frame.analysisKind !== "repetition";
              const isScorable =
                frame.scorable !== false && Number.isFinite(frame.accuracy);
              const frameRuleErrors = getFrameRuleErrors(frame);
              const needsReview =
                (isScorable && frame.accuracy < CLEAN_ACCURACY) ||
                frameRuleErrors.length > 0;
              return (
                <button
                  aria-label={`Frame ${frame.frame}, ${frameIsPreparation ? "preparation" : `rep ${frame.analysisRep}, step ${frame.step}`}, ${isScorable ? `${frame.accuracy}% accuracy` : "movement transition"}`}
                  className={`${index === fullTapeCursor ? "is-current" : ""} ${!isScorable ? "is-transition" : needsReview ? "is-review" : "is-clean"} is-filter-match`}
                  key={frame.frame}
                  onClick={() => {
                    setIsFullTapePlaying(false);
                    setFullTapeCursor(index);
                  }}
                  type="button"
                >
                  <TapeSkeleton
                    highlightBodyPart={
                      needsReview ? frame.focusBodyPart : null
                    }
                    highlightBodyParts={
                      needsReview ? frame.wrongBodyParts : []
                    }
                    landmarks={frame.landmarks}
                    mirrored={displayMirrored}
                  />
                  <span className="practice-camera-roll__frame">F{frame.frame}</span>
                  <time>{formatTapeTime(frame.elapsedMs)}</time>
                  <span>
                    {frameIsPreparation
                      ? "PREP"
                      : `R${frame.analysisRep}`} ·{" "}
                    {frameIsPreparation
                      ? "Waiting"
                      : `S${frame.step}`} ·{" "}
                    {frame.attentionTiming === "on-time"
                      ? "ON"
                      : frame.attentionTiming?.toUpperCase()}
                  </span>
                  <strong>{isScorable ? `${frame.accuracy}%` : "MOVE"}</strong>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {historySessionPopup ? (
        <section
          aria-label={`${historySessionPopup.technique_name} session analysis`}
          aria-modal="true"
          className="practice-history-popup"
          role="dialog"
        >
          <div className="practice-history-popup__header">
            <div>
              <p className="eyebrow">Saved session</p>
              <h2>{historySessionPopup.technique_name}</h2>
              <time dateTime={historySessionPopup.ended_at || historySessionPopup.started_at || undefined}>
                {formatSessionTimestamp(
                  historySessionPopup.ended_at || historySessionPopup.started_at
                )}
              </time>
            </div>
            <button onClick={() => setHistorySessionPopup(null)} type="button">
              Close
            </button>
          </div>
          <div className="practice-history-popup__metrics">
            <span><small>Average form</small><strong>{historySessionPopup.average_accuracy}%</strong></span>
            <span><small>Best form</small><strong>{historySessionPopup.best_accuracy}%</strong></span>
            <span><small>Repetitions</small><strong>{historySessionPopup.completed_reps}/{historySessionPopup.target_reps}</strong></span>
            <span><small>Clean reps</small><strong>{historySessionPopup.clean_reps}</strong></span>
            <span><small>Consistency</small><strong>{historySessionPopup.consistency_score}%</strong></span>
            <span><small>Average pace</small><strong>{historySessionPopup.average_rep_seconds}s</strong></span>
            <span><small>Started</small><strong>{formatSessionTimestamp(historySessionPopup.started_at)}</strong></span>
            <span><small>Finished</small><strong>{formatSessionTimestamp(historySessionPopup.ended_at)}</strong></span>
          </div>
          <div className="practice-history-popup__notice">
            <span>Summary view</span>
            <strong>
              The detailed movement tape could not be loaded for this session.
              Summary metrics are still available.
            </strong>
          </div>
        </section>
      ) : null}
    </>
  );
}
