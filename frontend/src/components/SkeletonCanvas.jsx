import { useCallback, useEffect, useRef } from "react";
import {
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";

import ExpectedPoseGuide from "./ExpectedPoseGuide";
import { drawSkeleton } from "../utils/drawSkeleton";
import { Level1MotionLayer } from "../temporal/level1MotionLayer";
import { Level2ActionLayer } from "../temporal/level2ActionLayer";
import { Level3SessionLayer } from "../temporal/level3SessionLayer";
import { Level4UserLayer } from "../temporal/level4UserLayer";
import { SituationAwarenessLayer } from "../situationAwareness/SituationAwarenessLayer";
import { buildCoachContextPacket } from "../situationAwareness/buildCoachContextPacket";
import {
  applyStudioPerformanceMode,
  getAdaptiveSmoothing,
  getStudioPerformanceConfig
} from "../performance/studioPerformanceConfig";
import { WS_BASE_URL } from "../services/api";
import { getBodyCalibrationSample, getCalibrationFit } from "../utils/bodyCalibration";
import { assignHandSides } from "../utils/handSideAssignment";

const BODY_PART_MAP = {
  elbow_right: [12, 14, 16],
  elbow_left: [11, 13, 15],
  shoulder_right: [14, 12, 24],
  shoulder_left: [13, 11, 23],
  knee_right: [24, 26, 28],
  knee_left: [23, 25, 27],
  hip_right: [12, 24, 26],
  hip_left: [11, 23, 25],
  ankle_right: [26, 28, 32],
  ankle_left: [25, 27, 31],
  wrist_right: [14, 16, 20],
  wrist_left: [13, 15, 19]
};

const MIN_LANDMARK_VISIBILITY = 0.45;
const HAND_TRACKING_KEYWORDS = ["fist", "punch", "jab", "cross", "guard", "hand"];
const POSE_HAND_POINTS = {
  left: { wrist: 15, pinky: 17, index: 19, thumb: 21 },
  right: { wrist: 16, pinky: 18, index: 20, thumb: 22 }
};

function calculateAngle(a, b, c) {
  const ab = {
    x: a.x - b.x,
    y: a.y - b.y,
    z: (a.z || 0) - (b.z || 0)
  };
  const cb = {
    x: c.x - b.x,
    y: c.y - b.y,
    z: (c.z || 0) - (b.z || 0)
  };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const abLength = Math.hypot(ab.x, ab.y, ab.z);
  const cbLength = Math.hypot(cb.x, cb.y, cb.z);

  if (!abLength || !cbLength) return null;

  const cosine = Math.min(1, Math.max(-1, dot / (abLength * cbLength)));
  const angle = Math.acos(cosine) * (180 / Math.PI);

  return angle;
}

function hasVisiblePoints(points) {
  return points.every(
    (point) => point && (point.visibility == null || point.visibility >= MIN_LANDMARK_VISIBILITY)
  );
}

function distance(first, second) {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    (first.z || 0) - (second.z || 0)
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compensatePredictionLatency(predictedLandmarks, sourceLandmarks, currentLandmarks) {
  if (!predictedLandmarks?.length || !sourceLandmarks?.length || !currentLandmarks?.length) {
    return predictedLandmarks || null;
  }

  return predictedLandmarks.map((point, index) => {
    const source = sourceLandmarks[index];
    const current = currentLandmarks[index];

    if (!point || !source || !current) return point;

    return {
      ...point,
      x: point.x + ((current.x || 0) - (source.x || 0)),
      y: point.y + ((current.y || 0) - (source.y || 0)),
      z: (point.z || 0) + ((current.z || 0) - (source.z || 0)),
      visibility: current.visibility ?? point.visibility
    };
  });
}

function shouldTrackHands(requiredParts = [], stepName = "") {
  const hasHandTarget = requiredParts.some((part) =>
    /fist|hand|wrist/i.test(part.body_part)
  );
  const hasHandStepName = HAND_TRACKING_KEYWORDS.some((keyword) =>
    stepName.toLowerCase().includes(keyword)
  );

  return hasHandTarget || hasHandStepName;
}

function waitForVideoMetadata(video) {
  if (!video) return Promise.resolve();
  if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener("loadedmetadata", finish);
      resolve();
    };

    video.addEventListener("loadedmetadata", finish, { once: true });
    window.setTimeout(finish, 1200);
  });
}

function syncCanvasToVideo(canvas, video) {
  if (!canvas || !video) return;

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;

  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
}

function getHandEntries(handLandmarksList, poseLandmarks, handednessList = []) {
  return assignHandSides(handLandmarksList, poseLandmarks, handednessList);
}

function getFistScore(hand) {
  const wrist = hand[0];
  const indexMcp = hand[5];
  const middleMcp = hand[9];
  const pinkyMcp = hand[17];
  const fingers = [
    [hand[5], hand[6], hand[7], hand[8]],
    [hand[9], hand[10], hand[11], hand[12]],
    [hand[13], hand[14], hand[15], hand[16]],
    [hand[17], hand[18], hand[19], hand[20]]
  ];
  const fingertips = fingers.map((finger) => finger[3]);
  const palmSize = Math.max(
    distance(wrist, middleMcp),
    distance(indexMcp, pinkyMcp),
    0.001
  );
  const averageTipDistance =
    fingertips.reduce((total, point) => total + distance(point, wrist), 0) /
    fingertips.length;
  const openRatio = averageTipDistance / palmSize;
  const palmClosure = clamp(((1.55 - openRatio) / 0.75) * 100, 0, 100);
  const fingerClosure =
    fingers.reduce((total, [mcp, pip, dip, tip]) => {
      const fingerLength =
        distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);

      if (!fingerLength) return total;

      const foldRatio = distance(tip, mcp) / fingerLength;
      return total + clamp(((0.95 - foldRatio) / 0.45) * 100, 0, 100);
    }, 0) / fingers.length;

  return Math.round((fingerClosure * 0.65) + (palmClosure * 0.35));
}

function getPoseHandFallback(poseLandmarks, side) {
  const indices = POSE_HAND_POINTS[side];
  const entries = Object.entries(indices)
    .map(([name, index]) => ({ name, point: poseLandmarks?.[index] }))
    .filter(({ point }) =>
      point && (point.visibility == null || point.visibility >= MIN_LANDMARK_VISIBILITY)
    );
  const hasWrist = entries.some((entry) => entry.name === "wrist");

  if (!hasWrist || entries.length < 3) {
    return {
      visible: false,
      fistScore: null,
      openScore: null,
      state: "Not visible",
      source: "pose33"
    };
  }

  return {
    visible: true,
    fistScore: null,
    openScore: null,
    state: "Position tracked",
    source: "pose33"
  };
}

function hasVisiblePoseHand(poseLandmarks) {
  return ["left", "right"].some((side) =>
    getPoseHandFallback(poseLandmarks, side).visible
  );
}

function getHandAwareness(handLandmarksList, poseLandmarks, handednessList) {
  const hands = {
    left: getPoseHandFallback(poseLandmarks, "left"),
    right: getPoseHandFallback(poseLandmarks, "right")
  };

  getHandEntries(handLandmarksList, poseLandmarks, handednessList).forEach(({ hand, side }) => {
    const fistScore = getFistScore(hand);

    hands[side] = {
      visible: true,
      fistScore,
      openScore: 100 - fistScore,
      state: fistScore >= 70 ? "Closed fist" : fistScore <= 35 ? "Open hand" : "Half closed",
      source: "hand21"
    };
  });

  return hands;
}

function getHandScores(handLandmarksList, poseLandmarks, handednessList) {
  const awareness = getHandAwareness(handLandmarksList, poseLandmarks, handednessList);
  const scores = {};

  ["left", "right"].forEach((side) => {
    const hand = awareness[side];

    if (!hand?.visible || !Number.isFinite(hand.fistScore)) return;

    scores[`fist_${side}`] = hand.fistScore;
    scores[`hand_${side}_open`] = hand.openScore;
  });

  return scores;
}

function getFaceAwareness(faceLandmarks, mirrored = false) {
  if (!faceLandmarks?.length) {
    return {
      visible: false,
      focus: "Not visible",
      forwardScore: null,
      eyeScore: null,
      calmScore: null,
      expression: "--"
    };
  }

  const leftEyeOuter = faceLandmarks[33];
  const leftEyeInner = faceLandmarks[133];
  const rightEyeInner = faceLandmarks[362];
  const rightEyeOuter = faceLandmarks[263];
  const leftEyeUpper = faceLandmarks[159];
  const leftEyeLower = faceLandmarks[145];
  const rightEyeUpper = faceLandmarks[386];
  const rightEyeLower = faceLandmarks[374];
  const nose = faceLandmarks[1];
  const mouthLeft = faceLandmarks[61];
  const mouthRight = faceLandmarks[291];
  const mouthUpper = faceLandmarks[13];
  const mouthLower = faceLandmarks[14];

  if (
    !leftEyeOuter ||
    !leftEyeInner ||
    !rightEyeInner ||
    !rightEyeOuter ||
    !nose ||
    !mouthLeft ||
    !mouthRight
  ) {
    return {
      visible: false,
      focus: "Face partial",
      forwardScore: null,
      eyeScore: null,
      calmScore: null,
      expression: "--"
    };
  }

  const eyeCenter = {
    x: (leftEyeOuter.x + rightEyeOuter.x) / 2,
    y: (leftEyeOuter.y + rightEyeOuter.y) / 2
  };
  const eyeWidth = Math.max(distance(leftEyeOuter, rightEyeOuter), 0.001);
  const mouthWidth = Math.max(distance(mouthLeft, mouthRight), 0.001);
  const yawOffset = Math.abs(nose.x - eyeCenter.x) / eyeWidth;
  const mouthCenterY = (mouthLeft.y + mouthRight.y) / 2;
  const pitchOffset = Math.abs(nose.y - ((eyeCenter.y + mouthCenterY) / 2)) / eyeWidth;
  const forwardScore = Math.round(clamp(100 - (yawOffset * 260) - (pitchOffset * 80), 0, 100));
  const leftEyeOpen = leftEyeUpper && leftEyeLower
    ? distance(leftEyeUpper, leftEyeLower) / distance(leftEyeOuter, leftEyeInner)
    : 0;
  const rightEyeOpen = rightEyeUpper && rightEyeLower
    ? distance(rightEyeUpper, rightEyeLower) / distance(rightEyeInner, rightEyeOuter)
    : 0;
  const eyeScore = Math.round(clamp(((leftEyeOpen + rightEyeOpen) / 2) * 360, 0, 100));
  const mouthOpen = mouthUpper && mouthLower
    ? distance(mouthUpper, mouthLower) / mouthWidth
    : 0;
  const calmScore = Math.round(clamp(100 - mouthOpen * 260, 0, 100));
  const expression = mouthOpen > 0.16 ? "High tension" : mouthOpen > 0.09 ? "Working" : "Calm";
  const rawHorizontal = nose.x < eyeCenter.x - eyeWidth * 0.08
    ? "Turned right"
    : nose.x > eyeCenter.x + eyeWidth * 0.08
      ? "Turned left"
      : "Forward";
  const horizontal = mirrored && rawHorizontal !== "Forward"
    ? rawHorizontal === "Turned left" ? "Turned right" : "Turned left"
    : rawHorizontal;
  const focus = forwardScore >= 70 && eyeScore >= 45 ? "Focused forward" : horizontal;

  return {
    visible: true,
    focus,
    forwardScore,
    eyeScore,
    calmScore,
    expression
  };
}

function getFaceScores(faceLandmarks) {
  const awareness = getFaceAwareness(faceLandmarks);

  if (!awareness.visible) {
    return {};
  }

  return {
    face_forward: awareness.forwardScore,
    eyes_forward: awareness.eyeScore,
    face_calm: awareness.calmScore
  };
}

function getFaceDetailPoints(faceLandmarks) {
  if (!faceLandmarks?.length) return [];

  return faceLandmarks.map((point, index) => ({
    index,
    x: point.x,
    y: point.y
  }));
}

function getPoseFaceLandmarks(poseLandmarks = []) {
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((index) => {
      const point = poseLandmarks[index];
      return point ? { ...point, index } : null;
    })
    .filter(Boolean);
}

function getPoseFaceAwareness(poseLandmarks, mirrored = false) {
  const points = getPoseFaceLandmarks(poseLandmarks);
  const pointMap = new Map(points.map((point) => [point.index, point]));
  const nose = pointMap.get(0);
  const averagePoints = (indices) => {
    const available = indices.map((index) => pointMap.get(index)).filter(Boolean);
    if (!available.length) return null;
    return {
      x: available.reduce((total, point) => total + point.x, 0) / available.length,
      y: available.reduce((total, point) => total + point.y, 0) / available.length,
      z: available.reduce((total, point) => total + (point.z || 0), 0) / available.length
    };
  };
  const leftEye = averagePoints([1, 2, 3]);
  const rightEye = averagePoints([4, 5, 6]);
  const mouthLeft = pointMap.get(9);
  const mouthRight = pointMap.get(10);

  if (!nose || !leftEye || !rightEye) {
    return {
      visible: false,
      focus: "Head partial",
      forwardScore: null,
      eyeScore: null,
      calmScore: null,
      expression: "--",
      source: "pose"
    };
  }

  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2
  };
  const eyeWidth = Math.max(distance(leftEye, rightEye), 0.001);
  const yawOffset = Math.abs(nose.x - eyeCenter.x) / eyeWidth;
  const mouthCenter = mouthLeft && mouthRight
    ? {
        x: (mouthLeft.x + mouthRight.x) / 2,
        y: (mouthLeft.y + mouthRight.y) / 2
      }
    : { x: eyeCenter.x, y: eyeCenter.y + eyeWidth * 0.75 };
  const pitchOffset = Math.abs(nose.y - (eyeCenter.y + mouthCenter.y) / 2) / eyeWidth;
  const depthYawDegrees = Math.atan2(
    Math.abs((leftEye.z || 0) - (rightEye.z || 0)),
    Math.max(Math.abs(leftEye.x - rightEye.x), 0.001)
  ) * (180 / Math.PI);
  const centerYawDegrees = clamp(yawOffset * 75, 0, 90);
  const yawDegrees = Math.round(clamp(depthYawDegrees * 0.65 + centerYawDegrees * 0.35, 0, 90));
  const forwardScore = Math.round(
    clamp(100 - Math.max(0, yawDegrees - 7) * 2.25 - Math.max(0, pitchOffset - 0.35) * 18, 0, 100)
  );
  const eyeScore = Math.round(clamp(100 - Math.abs(leftEye.y - rightEye.y) / eyeWidth * 190, 0, 100));
  const mouthWidth = mouthLeft && mouthRight ? distance(mouthLeft, mouthRight) / eyeWidth : 0;
  const calmScore = Math.round(clamp(78 - Math.max(0, mouthWidth - 0.45) * 70, 45, 92));
  const rawHorizontal = nose.x < eyeCenter.x - eyeWidth * 0.1
    ? "Turned right"
    : nose.x > eyeCenter.x + eyeWidth * 0.1
      ? "Turned left"
      : "Forward";
  const horizontal = mirrored && rawHorizontal !== "Forward"
    ? rawHorizontal === "Turned left" ? "Turned right" : "Turned left"
    : rawHorizontal;

  return {
    visible: true,
    focus: yawDegrees <= 15 ? "Focused forward" : yawDegrees <= 28 ? "Slightly turned" : horizontal,
    forwardScore,
    yawDegrees,
    eyeScore,
    calmScore,
    expression: "Pose face",
    source: "pose"
  };
}

function getPoseFaceScores(poseLandmarks) {
  const awareness = getPoseFaceAwareness(poseLandmarks);

  if (!awareness.visible) {
    return {};
  }

  return {
    face_forward: awareness.forwardScore,
    eyes_forward: awareness.eyeScore,
    face_calm: awareness.calmScore
  };
}

function getPoseFaceDetailPoints(poseLandmarks) {
  return getPoseFaceLandmarks(poseLandmarks).map((point) => ({
    index: point.index,
    x: point.x,
    y: point.y
  }));
}

function getStanceAwareness(worldPose, targetDegrees = 0) {
  const leftShoulder = worldPose?.[11];
  const rightShoulder = worldPose?.[12];
  if (!leftShoulder || !rightShoulder) {
    return { visible: false, targetDegrees, currentDegrees: null, score: null, guidance: "Bring both shoulders into view." };
  }

  const horizontal = Math.abs(leftShoulder.x - rightShoulder.x);
  const depth = Math.abs((leftShoulder.z || 0) - (rightShoulder.z || 0));
  if (horizontal < 0.001 && depth < 0.001) {
    return { visible: false, targetDegrees, currentDegrees: null, score: null, guidance: "Hold your shoulders in view." };
  }

  const currentDegrees = Math.round(Math.atan2(depth, horizontal) * (180 / Math.PI));
  const tolerance = targetDegrees === 0 ? 15 : targetDegrees >= 90 ? 12 : 10;
  const difference = currentDegrees - targetDegrees;
  const score = Math.round(clamp(100 - Math.abs(difference) / tolerance * 100, 0, 100));
  const guidance = Math.abs(difference) <= tolerance
    ? "Stance angle is on target."
    : targetDegrees === 0
      ? `Square your shoulders toward the camera about ${currentDegrees}°.`
      : targetDegrees === 90
        ? `Turn into a side profile about ${Math.abs(difference)}° more.`
        : difference < 0
          ? `Turn your torso about ${Math.abs(difference)}° more.`
          : `Rotate back about ${Math.abs(difference)}°.`;

  return { visible: true, targetDegrees, currentDegrees, score, guidance };
}

function getHandDetailPoints(handEntries = [], poseLandmarks = []) {
  const poseDetails = Object.entries(POSE_HAND_POINTS).reduce((details, [side, indices]) => {
    details[side] = [
      [0, indices.wrist],
      [4, indices.thumb],
      [8, indices.index],
      [20, indices.pinky]
    ]
      .map(([index, poseIndex]) => ({ index, point: poseLandmarks?.[poseIndex] }))
      .filter(({ point }) =>
        point && (point.visibility == null || point.visibility >= MIN_LANDMARK_VISIBILITY)
      )
      .map(({ index, point }) => ({ index, x: point.x, y: point.y }));
    return details;
  }, {});

  return handEntries.reduce((details, entry) => {
    details[entry.side] = entry.hand.map((point, index) => ({
      index,
      x: point.x,
      y: point.y
    }));
    return details;
  }, poseDetails);
}

function createLandmarkFrame({
  timestamp,
  poseLandmarks,
  angleLandmarks,
  handLandmarksList,
  handednessList,
  faceLandmarks
}) {
  const handEntries = getHandEntries(handLandmarksList, poseLandmarks, handednessList);

  return {
    timestamp,
    pose: poseLandmarks,
    worldPose: angleLandmarks || poseLandmarks,
    hands: handLandmarksList || [],
    handedness: handednessList || [],
    handEntries,
    face: faceLandmarks || null
  };
}

function getHolisticScores(frame, includeHands, includeFace) {
  const scores = {};

  if (includeHands) {
    Object.assign(scores, getHandScores(frame.hands, frame.pose, frame.handedness));
  }

  if (includeFace && frame.face) {
    Object.assign(scores, getFaceScores(frame.face));
  } else {
    Object.assign(scores, getPoseFaceScores(frame.pose));
  }

  return scores;
}

function getCorrectionParts(requiredParts = [], anglesPayload = {}) {
  return new Set(
    requiredParts
      .filter((part) => {
        const canColorSkeleton =
          BODY_PART_MAP[part.body_part] ||
          part.body_part.startsWith("fist_") ||
          part.body_part.startsWith("hand_");

        if (!canColorSkeleton) return false;

        const value = anglesPayload[part.body_part];
        return Number.isFinite(value) && (value < part.min || value > part.max);
      })
      .map((part) => part.body_part)
  );
}

export default function SkeletonCanvas({
  enableCoach = true,
  displayMirrored = true,
  skeletonLayers = {},
  currentStepId,
  currentStepName,
  sessionConfig,
  coachCommand,
  requiredParts,
  onAngleUpdate,
  onAccuracyUpdate,
  onFeedbackUpdate,
  onSummaryUpdate,
  onCoachEvent,
  onAwarenessUpdate,
  onLevel1Update,
  onLevel2Update,
  onLevel3Update,
  onLevel4Update,
  onSituationAwarenessUpdate,
  bodyCalibration,
  calibrationActive = false,
  onBodyCalibrationSample,
  onCalibrationStatus,
  stanceTargetDegrees = 0,
  enableAwareness = false,
  performanceProfile = "student",
  performanceMode = "auto"
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const faceRef = useRef(null);
  const visionRef = useRef(null);
  const wsRef = useRef(null);
  const previousPoseRef = useRef(null);
  const previousWorldPoseRef = useRef(null);
  const previousDisplayPoseRef = useRef(null);
  const previousHandsRef = useRef(null);
  const previousHandednessRef = useRef(null);
  const previousFaceRef = useRef(null);
  const lastHandSeenTimeRef = useRef(0);
  const lastFaceSeenTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const lastHandTimeRef = useRef(0);
  const lastFaceTimeRef = useRef(0);
  const lastAwarenessTimeRef = useRef(0);
  const lastCoachSendTimeRef = useRef(0);
  const lastCoachContextSendTimeRef = useRef(0);
  const lastCoachContextSignatureRef = useRef("");
  const lastMotionQualityRef = useRef({ trackingConfidence: 0.75, motionEnergy: 0 });
  const lastAnglePayloadRef = useRef({});
  const lastCommandIdRef = useRef(null);
  const pendingCommandRef = useRef(null);
  const currentStepIdRef = useRef(currentStepId);
  const currentStepNameRef = useRef(currentStepName);
  const requiredPartsRef = useRef(requiredParts);
  const sessionConfigRef = useRef(sessionConfig);
  const basePerformanceConfigRef = useRef(getStudioPerformanceConfig(performanceProfile));
  const adaptiveTierRef = useRef("balanced");
  const performanceModeRef = useRef(performanceMode);
  const performanceConfigRef = useRef(
    applyStudioPerformanceMode(
      getStudioPerformanceConfig(performanceProfile),
      performanceMode
    )
  );
  const shouldTrackHandsRef = useRef(false);
  const shouldTrackFaceRef = useRef(false);
  const enableAwarenessRef = useRef(enableAwareness);
  const displayMirroredRef = useRef(displayMirrored);
  const skeletonLayersRef = useRef(skeletonLayers);
  const handModelPromiseRef = useRef(null);
  const faceModelPromiseRef = useRef(null);
  const level1MotionRef = useRef(new Level1MotionLayer());
  const level2ActionRef = useRef(new Level2ActionLayer(getStudioPerformanceConfig(performanceProfile)));
  const level3SessionRef = useRef(new Level3SessionLayer());
  const level4UserRef = useRef(new Level4UserLayer());
  const situationAwarenessRef = useRef(new SituationAwarenessLayer());
  const bodyCalibrationRef = useRef(bodyCalibration);
  const calibrationActiveRef = useRef(calibrationActive);
  const enableCoachRef = useRef(enableCoach);
  const onBodyCalibrationSampleRef = useRef(onBodyCalibrationSample);
  const onCalibrationStatusRef = useRef(onCalibrationStatus);
  const onAngleUpdateRef = useRef(onAngleUpdate);
  const onAccuracyUpdateRef = useRef(onAccuracyUpdate);
  const onFeedbackUpdateRef = useRef(onFeedbackUpdate);
  const onSummaryUpdateRef = useRef(onSummaryUpdate);
  const onCoachEventRef = useRef(onCoachEvent);
  const onAwarenessUpdateRef = useRef(onAwarenessUpdate);
  const onLevel1UpdateRef = useRef(onLevel1Update);
  const onLevel2UpdateRef = useRef(onLevel2Update);
  const onLevel3UpdateRef = useRef(onLevel3Update);
  const onLevel4UpdateRef = useRef(onLevel4Update);
  const onSituationAwarenessUpdateRef = useRef(onSituationAwarenessUpdate);
  const stanceTargetDegreesRef = useRef(stanceTargetDegrees);
  const lastCalibrationStatusTimeRef = useRef(0);
  const lastLevel1UpdateTimeRef = useRef(0);
  const lastLevel2UpdateTimeRef = useRef(0);
  const lastLevel3UpdateTimeRef = useRef(0);
  const lastLevel4UpdateTimeRef = useRef(0);
  const lastSituationAwarenessUpdateTimeRef = useRef(0);

  const sendCoachCommand = useCallback((command) => {
    if (!command || wsRef.current?.readyState !== WebSocket.OPEN) {
      pendingCommandRef.current = command;
      return;
    }

    lastCommandIdRef.current = command.id;
    wsRef.current.send(
      JSON.stringify({
        type: command.type || "user_message",
        message: command.message
      })
    );
    pendingCommandRef.current = null;
  }, []);

  useEffect(() => {
    currentStepIdRef.current = currentStepId;
    currentStepNameRef.current = currentStepName;
    enableCoachRef.current = enableCoach;
    requiredPartsRef.current = requiredParts;
    sessionConfigRef.current = sessionConfig;
    enableAwarenessRef.current = enableAwareness;
    displayMirroredRef.current = displayMirrored;
    skeletonLayersRef.current = skeletonLayers;
    performanceModeRef.current = performanceMode;
    basePerformanceConfigRef.current = getStudioPerformanceConfig(performanceProfile, {
      onnxEnabled: Boolean(skeletonLayers?.onnx)
    });
    performanceConfigRef.current = applyStudioPerformanceMode(
      basePerformanceConfigRef.current,
      performanceMode,
      adaptiveTierRef.current
    );
    level2ActionRef.current.config = {
      ...level2ActionRef.current.config,
      onnxEnabled: performanceConfigRef.current.onnxEnabled,
      onnxIntervalMs: performanceConfigRef.current.onnxIntervalMs
    };
    shouldTrackHandsRef.current =
      performanceConfigRef.current.handMode === "always" ||
      shouldTrackHands(requiredParts, currentStepName);
    shouldTrackFaceRef.current = Boolean(enableAwareness && performanceConfigRef.current.enableFace);
    if (enableCoach && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "session_config",
          ...sessionConfig,
          step_key: currentStepId,
          step_name: currentStepName
        })
      );
    }
  }, [
    currentStepId,
    currentStepName,
    displayMirrored,
    enableAwareness,
    enableCoach,
    requiredParts,
    skeletonLayers,
    sessionConfig,
    performanceProfile,
    performanceMode
  ]);

  useEffect(() => {
    onBodyCalibrationSampleRef.current = onBodyCalibrationSample;
    onCalibrationStatusRef.current = onCalibrationStatus;
  }, [onBodyCalibrationSample, onCalibrationStatus]);

  useEffect(() => {
    onAngleUpdateRef.current = onAngleUpdate;
    onAccuracyUpdateRef.current = onAccuracyUpdate;
    onFeedbackUpdateRef.current = onFeedbackUpdate;
    onSummaryUpdateRef.current = onSummaryUpdate;
    onCoachEventRef.current = onCoachEvent;
    onAwarenessUpdateRef.current = onAwarenessUpdate;
    onLevel1UpdateRef.current = onLevel1Update;
    onLevel2UpdateRef.current = onLevel2Update;
    onLevel3UpdateRef.current = onLevel3Update;
    onLevel4UpdateRef.current = onLevel4Update;
    onSituationAwarenessUpdateRef.current = onSituationAwarenessUpdate;
  }, [
    onAccuracyUpdate,
    onAngleUpdate,
    onAwarenessUpdate,
    onCoachEvent,
    onFeedbackUpdate,
    onLevel1Update,
    onLevel2Update,
    onLevel3Update,
    onLevel4Update,
    onSituationAwarenessUpdate,
    onSummaryUpdate
  ]);

  useEffect(() => {
    bodyCalibrationRef.current = bodyCalibration;
    calibrationActiveRef.current = calibrationActive;
  }, [bodyCalibration, calibrationActive]);

  useEffect(() => {
    stanceTargetDegreesRef.current = stanceTargetDegrees;
  }, [stanceTargetDegrees]);

  useEffect(() => {
    if (!enableCoach) {
      return undefined;
    }

    const token = localStorage.getItem("token");
    const socket = new WebSocket(`${WS_BASE_URL}/ws/train`);
    let disposed = false;
    wsRef.current = socket;

    socket.onopen = () => {
      if (disposed) {
        socket.close();
        return;
      }

      socket.send(JSON.stringify({ type: "authenticate", token }));
      socket.send(
        JSON.stringify({
          type: "session_config",
          ...sessionConfigRef.current,
          step_key: currentStepIdRef.current,
          step_name: currentStepNameRef.current
        })
      );

      if (pendingCommandRef.current) {
        sendCoachCommand(pendingCommandRef.current);
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      onAccuracyUpdateRef.current?.(data.accuracy);
      onFeedbackUpdateRef.current?.(data.feedback?.join("\n") || data.message || "");

      if (data.summary) {
        onSummaryUpdateRef.current?.(data.summary);
      }

      onCoachEventRef.current?.(data);
    };

    return () => {
      disposed = true;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };
  }, [
    enableCoach,
    sendCoachCommand
  ]);

  useEffect(() => {
    let animationFrameId;
    let cameraStream;
    let isDisposed = false;
    let processingSamples = [];
    let lastPerformanceTuneTime = 0;

    const updateAdaptivePerformance = (processingMs, timestamp) => {
      if (performanceModeRef.current !== "auto") return;

      processingSamples.push(processingMs);
      processingSamples = processingSamples.slice(-36);
      if (processingSamples.length < 18 || timestamp - lastPerformanceTuneTime < 3000) {
        return;
      }

      const averageProcessingMs =
        processingSamples.reduce((total, value) => total + value, 0) /
        processingSamples.length;
      const currentTier = adaptiveTierRef.current;
      let nextTier = currentTier;

      if (averageProcessingMs > 48) {
        nextTier = "eco";
      } else if (averageProcessingMs > 32) {
        nextTier = "balanced";
      } else if (
        averageProcessingMs < 23 ||
        (currentTier === "eco" && averageProcessingMs < 27)
      ) {
        nextTier = "quality";
      }

      lastPerformanceTuneTime = timestamp;
      processingSamples = [];
      if (nextTier === currentTier) return;

      adaptiveTierRef.current = nextTier;
      performanceConfigRef.current = applyStudioPerformanceMode(
        basePerformanceConfigRef.current,
        "auto",
        nextTier
      );
    };

    const smoothLandmarks = (current, previous, smoothing = 0.6) => {
      if (!previous || previous.length !== current.length) return current;

      return current.map((point, index) => ({
        x: previous[index].x * (1 - smoothing) + point.x * smoothing,
        y: previous[index].y * (1 - smoothing) + point.y * smoothing,
        z: previous[index].z * (1 - smoothing) + point.z * smoothing,
        visibility: point.visibility
      }));
    };

    const ensureHandLandmarker = async () => {
      if (handRef.current || handModelPromiseRef.current || !visionRef.current) {
        return;
      }

      handModelPromiseRef.current = HandLandmarker.createFromOptions(
        visionRef.current,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
          },
          runningMode: "VIDEO",
          numHands: 2
        }
      )
        .then((landmarker) => {
          handRef.current = landmarker;
        })
        .finally(() => {
          handModelPromiseRef.current = null;
        });
    };

    const ensureFaceLandmarker = async () => {
      if (faceRef.current || faceModelPromiseRef.current || !visionRef.current) {
        return;
      }

      faceModelPromiseRef.current = FaceLandmarker.createFromOptions(
        visionRef.current,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
          },
          runningMode: "VIDEO",
          numFaces: 1
        }
      )
        .then((landmarker) => {
          faceRef.current = landmarker;
        })
        .finally(() => {
          faceModelPromiseRef.current = null;
        });
    };

    const sendCoachFrame = (anglesPayload) => {
      const now = performance.now();

      if (
        wsRef.current?.readyState !== WebSocket.OPEN ||
        !currentStepIdRef.current ||
        now - lastCoachSendTimeRef.current < performanceConfigRef.current.coachFrameIntervalMs
      ) {
        return;
      }

      lastCoachSendTimeRef.current = now;
      wsRef.current.send(
        JSON.stringify({
          step_id: currentStepIdRef.current,
          step_name: currentStepNameRef.current,
          required_parts: requiredPartsRef.current,
          angles: anglesPayload
        })
      );
    };

    // This is a display-only stabilizer. It sits after Level 1 so the white
    // skeleton is calm at rest, yet releases quickly when the student moves.
    // Coaching angles continue to use the independent angle landmark stream.
    const stabilizeDisplayLandmarks = (current, previous, motionEnergy = 0) => {
      if (!previous || previous.length !== current.length) return current;

      const smoothing = motionEnergy > 0.085 ? 0.6 : motionEnergy > 0.04 ? 0.46 : 0.3;
      const deadband = motionEnergy > 0.04 ? 0.0015 : 0.0035;

      return current.map((point, index) => {
        const prior = previous[index];
        const delta = Math.hypot(
          point.x - prior.x,
          point.y - prior.y,
          (point.z || 0) - (prior.z || 0)
        );

        if (delta < deadband) return { ...prior, visibility: point.visibility };

        return {
          x: prior.x * (1 - smoothing) + point.x * smoothing,
          y: prior.y * (1 - smoothing) + point.y * smoothing,
          z: (prior.z || 0) * (1 - smoothing) + (point.z || 0) * smoothing,
          visibility: point.visibility
        };
      });
    };

    const sendCoachContextPacket = ({
      level1State,
      level2State,
      level3State,
      level4State,
      situationAwarenessState
    }) => {
      const now = performance.now();

      if (wsRef.current?.readyState !== WebSocket.OPEN || !currentStepIdRef.current) {
        return;
      }

      const situation = situationAwarenessState?.situation_context;
      const agentContext = situation?.agent_context || {};
      const signature = [
        situation?.situation_state,
        agentContext.action,
        agentContext.target,
        agentContext.issue
      ].join(":");
      const changed = signature && signature !== lastCoachContextSignatureRef.current;
      const due =
        now - lastCoachContextSendTimeRef.current >=
        performanceConfigRef.current.coachContextIntervalMs;

      if (!changed && !due) {
        return;
      }

      const packet = buildCoachContextPacket({
        level1State,
        level2State,
        level3State,
        level4State,
        situationAwarenessState,
        mode: enableCoachRef.current ? "train" : "practice",
        techniqueName: sessionConfigRef.current?.technique_name,
        currentStepId: currentStepIdRef.current,
        currentStepName: currentStepNameRef.current
      });

      if (!packet) {
        return;
      }

      lastCoachContextSendTimeRef.current = now;
      lastCoachContextSignatureRef.current = signature;
      wsRef.current.send(JSON.stringify(packet));
    };

    const emitAngleUpdate = (anglesPayload) => {
      const previousAngles = lastAnglePayloadRef.current;
      const hasMeaningfulChange = Object.entries(anglesPayload).some(
        ([bodyPart, value]) =>
          !Number.isFinite(previousAngles[bodyPart]) ||
          Math.abs(previousAngles[bodyPart] - value) >= 1
      );

      if (!hasMeaningfulChange) {
        return;
      }

      lastAnglePayloadRef.current = anglesPayload;
      onAngleUpdateRef.current?.(anglesPayload);
    };

    const detect = () => {
      const now = performance.now();

      if (isDisposed || document.hidden) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (
        !videoRef.current ||
        !canvasRef.current ||
        (videoRef.current.readyState < 2 &&
          (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0))
      ) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      syncCanvasToVideo(canvasRef.current, videoRef.current);

      if (now - lastFrameTimeRef.current < 1000 / performanceConfigRef.current.poseFps) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      lastFrameTimeRef.current = now;
      const performanceConfig = performanceConfigRef.current;
      const processingStartedAt = performance.now();

      try {
        let poseLandmarks = null;
        let angleLandmarks = null;
      const hasFreshHands =
        shouldTrackHandsRef.current &&
        previousHandsRef.current &&
        now - lastHandSeenTimeRef.current <= performanceConfig.maxHandStaleMs;
      const hasFreshFace =
        shouldTrackFaceRef.current &&
        previousFaceRef.current &&
        now - lastFaceSeenTimeRef.current <= performanceConfig.maxFaceStaleMs;
      let handLandmarksList = hasFreshHands ? previousHandsRef.current : null;
      let handednessList = hasFreshHands ? previousHandednessRef.current : null;
      let faceLandmarks = hasFreshFace ? previousFaceRef.current : null;

      if (poseRef.current) {
        const result = poseRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          const liveCalibrationFit = getCalibrationFit(
            result.landmarks[0],
            bodyCalibrationRef.current
          );
          const baseSmoothing = getAdaptiveSmoothing({
            trackingConfidence: lastMotionQualityRef.current.trackingConfidence,
            motionEnergy: lastMotionQualityRef.current.motionEnergy
          });
          // A changed camera position can make proportions look different in 2D.
          // Add a little smoothing for display stability; never change technique scoring.
          const poseSmoothing = bodyCalibrationRef.current?.ratios && liveCalibrationFit.score < 62
            ? Math.min(0.76, baseSmoothing + 0.1)
            : baseSmoothing;
          poseLandmarks = smoothLandmarks(
            result.landmarks[0],
            previousPoseRef.current,
            poseSmoothing
          );

          previousPoseRef.current = poseLandmarks;

          if (result.worldLandmarks?.length > 0) {
            angleLandmarks = smoothLandmarks(
              result.worldLandmarks[0],
              previousWorldPoseRef.current,
              baseSmoothing
            );

            previousWorldPoseRef.current = angleLandmarks;
          } else {
            angleLandmarks = smoothLandmarks(
              result.landmarks[0],
              previousWorldPoseRef.current,
              baseSmoothing
            );
            previousWorldPoseRef.current = angleLandmarks;
          }
        }
      }

      if (
        shouldTrackHandsRef.current &&
        hasVisiblePoseHand(poseLandmarks) &&
        !handRef.current &&
        !handModelPromiseRef.current
      ) {
        ensureHandLandmarker();
      }

      if (
        shouldTrackFaceRef.current &&
        !faceRef.current &&
        !faceModelPromiseRef.current
      ) {
        ensureFaceLandmarker();
      }

      if (
        shouldTrackHandsRef.current &&
        handRef.current &&
        now - lastHandTimeRef.current > (
          lastMotionQualityRef.current.motionEnergy > 0.045
            ? Math.max(180, performanceConfig.handIntervalMs - 80)
            : performanceConfig.handIntervalMs + 80
        )
      ) {
        lastHandTimeRef.current = now;
        const result = handRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          handLandmarksList = result.landmarks.map((hand, index) =>
            smoothLandmarks(hand, previousHandsRef.current?.[index], 0.5)
          );
          handednessList = result.handedness || [];
          previousHandsRef.current = handLandmarksList;
          previousHandednessRef.current = handednessList;
          lastHandSeenTimeRef.current = now;
        } else if (now - lastHandSeenTimeRef.current > performanceConfig.maxHandStaleMs) {
          handLandmarksList = null;
          handednessList = null;
          previousHandsRef.current = null;
          previousHandednessRef.current = null;
        }
      }

      if (
        shouldTrackFaceRef.current &&
        faceRef.current &&
        now - lastFaceTimeRef.current > performanceConfig.faceIntervalMs
      ) {
        lastFaceTimeRef.current = now;
        const result = faceRef.current.detectForVideo(videoRef.current, now);

        if (result.faceLandmarks.length > 0) {
          faceLandmarks = result.faceLandmarks[0];
          previousFaceRef.current = faceLandmarks;
          lastFaceSeenTimeRef.current = now;
        } else if (now - lastFaceSeenTimeRef.current > performanceConfig.maxFaceStaleMs) {
          faceLandmarks = null;
          previousFaceRef.current = null;
        }
      }

      if (poseLandmarks) {
        const calibrationSample = getBodyCalibrationSample(poseLandmarks);
        if (calibrationActiveRef.current) {
          onBodyCalibrationSampleRef.current?.(calibrationSample);
        }
        const calibrationFit = getCalibrationFit(poseLandmarks, bodyCalibrationRef.current);
        if (now - lastCalibrationStatusTimeRef.current > 900) {
          lastCalibrationStatusTimeRef.current = now;
          onCalibrationStatusRef.current?.(calibrationFit);
        }
        const frame = createLandmarkFrame({
          timestamp: now,
          poseLandmarks,
          angleLandmarks,
          handLandmarksList,
          handednessList,
          faceLandmarks
        });
        const level1State = level1MotionRef.current.update(frame.pose, now);
        const level2State = level2ActionRef.current.update({
          level1State,
          requiredParts: requiredPartsRef.current,
          currentStepId: currentStepIdRef.current,
          currentStepName: currentStepNameRef.current,
          techniqueName: sessionConfigRef.current?.technique_name
        });
        lastMotionQualityRef.current = {
          trackingConfidence: level1State?.tracking?.confidence ?? 0.75,
          motionEnergy: level2State?.action_context?.motion_energy ?? lastMotionQualityRef.current.motionEnergy
        };
        const level3State = level3SessionRef.current.update({
          level1State,
          level2State,
          techniqueName: sessionConfigRef.current?.technique_name,
          currentStepName: currentStepNameRef.current
        });
        const level4State = level4UserRef.current.update({
          level3State,
          techniqueName: sessionConfigRef.current?.technique_name,
          currentStepName: currentStepNameRef.current
        });
        const situationAwarenessState = situationAwarenessRef.current.update({
          level1State,
          level2State,
          level3State,
          level4State,
          mode: enableCoachRef.current ? "train" : "practice"
        });
        const anglesPayload = getHolisticScores(
          frame,
          shouldTrackHandsRef.current,
          shouldTrackFaceRef.current
        );

        requiredPartsRef.current?.forEach((part) => {
          const mapping = BODY_PART_MAP[part.body_part];

          if (mapping) {
            const [a, b, c] = mapping;
            const points = [frame.worldPose?.[a], frame.worldPose?.[b], frame.worldPose?.[c]];

            if (hasVisiblePoints(points)) {
              const angle = calculateAngle(points[0], points[1], points[2]);

              if (Number.isFinite(angle)) {
                anglesPayload[part.body_part] = angle;
              }
            }
          }
        });

        if (
          onLevel1UpdateRef.current &&
          now - lastLevel1UpdateTimeRef.current > performanceConfig.level1UiIntervalMs
        ) {
          lastLevel1UpdateTimeRef.current = now;
          onLevel1UpdateRef.current(level1State);
        }

        if (
          onLevel2UpdateRef.current &&
          level2State &&
          now - lastLevel2UpdateTimeRef.current > performanceConfig.level2UiIntervalMs
        ) {
          lastLevel2UpdateTimeRef.current = now;
          onLevel2UpdateRef.current(level2State);
        }

        if (
          onLevel3UpdateRef.current &&
          level3State &&
          now - lastLevel3UpdateTimeRef.current > performanceConfig.level3UiIntervalMs
        ) {
          lastLevel3UpdateTimeRef.current = now;
          onLevel3UpdateRef.current(level3State);
        }

        if (
          onLevel4UpdateRef.current &&
          level4State &&
          now - lastLevel4UpdateTimeRef.current > performanceConfig.level4UiIntervalMs
        ) {
          lastLevel4UpdateTimeRef.current = now;
          onLevel4UpdateRef.current(level4State);
        }

        if (
          onSituationAwarenessUpdateRef.current &&
          situationAwarenessState &&
          now - lastSituationAwarenessUpdateTimeRef.current >
            performanceConfig.situationUiIntervalMs
        ) {
          lastSituationAwarenessUpdateTimeRef.current = now;
          onSituationAwarenessUpdateRef.current(situationAwarenessState);
        }

        const latencyCompensatedOnnxLandmarks = compensatePredictionLatency(
          level2State?.debug?.onnxPredictedLandmarks,
          level2State?.debug?.onnxPrediction?.source_landmarks,
          level1State?.debug?.currentLandmarks || frame.pose
        );

        const skeletonSource = level1State?.debug?.currentLandmarks || frame.pose;
        const displayLandmarks = stabilizeDisplayLandmarks(
          skeletonSource,
          previousDisplayPoseRef.current,
          level2State?.action_context?.motion_energy ?? 0
        );
        previousDisplayPoseRef.current = displayLandmarks;

        if (skeletonLayersRef.current.live === false) {
          const context = canvasRef.current?.getContext("2d", { alpha: true });
          context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        } else {
          drawSkeleton(
            canvasRef.current,
            displayLandmarks,
            skeletonLayersRef.current.corrections === false
              ? new Set()
              : getCorrectionParts(requiredPartsRef.current, anglesPayload),
            {
              mirrored: displayMirroredRef.current,
              correctParts: skeletonLayersRef.current.corrections === false
                ? new Set()
                : getCorrectParts(requiredPartsRef.current, anglesPayload),
              predictedLandmarks: skeletonLayersRef.current.level1
                ? level1State?.debug?.predictedLandmarks
                : null,
              onnxPredictedLandmarks: skeletonLayersRef.current.onnx
                ? latencyCompensatedOnnxLandmarks
                : null
            }
          );
        }

        emitAngleUpdate(anglesPayload);
        sendCoachFrame(anglesPayload);
        sendCoachContextPacket({
          level1State,
          level2State,
          level3State,
          level4State,
          situationAwarenessState
        });

        if (
          enableAwarenessRef.current &&
          onAwarenessUpdateRef.current &&
          now - lastAwarenessTimeRef.current > performanceConfig.awarenessIntervalMs
        ) {
          lastAwarenessTimeRef.current = now;
          onAwarenessUpdateRef.current({
            active: true,
            level1: {
              ready: level1State?.ready_for_next_layer || false,
              motionContext: level1State?.motion_context,
              tracking: level1State?.tracking
            },
            level2: {
              ready: level2State?.ready_for_situation_awareness || false,
              actionContext: level2State?.action_context
            },
            level3: {
              ready: level3State?.session_context?.ready_for_level_4 || false,
              sessionContext: level3State?.session_context
            },
            level4: {
              ready: level4State?.user_context?.progression?.ready_for_level_5 || false,
              userContext: level4State?.user_context
            },
            situationAwareness: {
              ready: Boolean(situationAwarenessState?.situation_context),
              situationContext: situationAwarenessState?.situation_context
            },
            faceEnabled: true,
            faceSource: frame.face ? "mesh" : "pose33",
            handsEnabled: shouldTrackHandsRef.current,
            face: frame.face
              ? getFaceAwareness(frame.face, displayMirroredRef.current)
              : getPoseFaceAwareness(frame.pose, displayMirroredRef.current),
            stance: getStanceAwareness(frame.worldPose, stanceTargetDegreesRef.current),
            facePoints: frame.face ? getFaceDetailPoints(frame.face) : getPoseFaceDetailPoints(frame.pose),
            handPoints: getHandDetailPoints(frame.handEntries, frame.pose),
            hands: getHandAwareness(frame.hands, frame.pose, frame.handedness)
          });
        }
      }

        updateAdaptivePerformance(performance.now() - processingStartedAt, now);
      } catch (error) {
        console.error("Studio tracking frame failed", error);
      } finally {
        if (!isDisposed) {
          animationFrameId = requestAnimationFrame(detect);
        }
      }
    };

    const startCamera = async () => {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 }
        }
      });

      if (isDisposed || !videoRef.current) return;

      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.srcObject = cameraStream;

      await waitForVideoMetadata(videoRef.current);
      if (isDisposed || !videoRef.current) return;

      await videoRef.current.play().catch(() => {});

      syncCanvasToVideo(canvasRef.current, videoRef.current);

      detect();
    };

    const init = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
      );
      visionRef.current = vision;

      poseRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
        },
        runningMode: "VIDEO",
        numPoses: 1
      });

      startCamera();
    };

    init();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      cameraStream?.getTracks().forEach((track) => track.stop());
      poseRef.current?.close?.();
      handRef.current?.close?.();
      faceRef.current?.close?.();
      poseRef.current = null;
      handRef.current = null;
      faceRef.current = null;
      visionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !enableCoach ||
      !coachCommand ||
      coachCommand.id === lastCommandIdRef.current
    ) {
      return;
    }

    sendCoachCommand(coachCommand);
  }, [coachCommand, enableCoach, sendCoachCommand]);

  return (
    <div className={`skeleton-canvas ${displayMirrored ? "skeleton-canvas--mirrored" : ""}`}>
      <video aria-hidden="true" ref={videoRef} autoPlay muted playsInline />
      <canvas ref={canvasRef} />
      {skeletonLayers.expected !== false ? (
        <ExpectedPoseGuide
          mirrored={displayMirrored}
          requiredParts={requiredParts}
          stepName={currentStepName}
        />
      ) : null}
      <div className="skeleton-canvas__overlay" />
    </div>
  );
}

function getCorrectParts(requiredParts = [], anglesPayload = {}) {
  return new Set(
    requiredParts
      .filter((part) => {
        if (!BODY_PART_MAP[part.body_part]) return false;

        const value = anglesPayload[part.body_part];
        return Number.isFinite(value) && value >= part.min && value <= part.max;
      })
      .map((part) => part.body_part)
  );
}
