import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  PredictionLedger,
  selectPredictionAwareDisplayPose
} from "../temporal/predictionLedger";
import { SituationAwarenessLayer } from "../situationAwareness/SituationAwarenessLayer";
import { buildCoachContextPacket } from "../situationAwareness/buildCoachContextPacket";

const SYNTHETIC_CONNECTIONS = [
  [0, 11], [0, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [27, 31], [28, 30], [28, 32]
];
const SYNTHETIC_HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const SYNTHETIC_DRAGGABLE_JOINTS = [
  0, 11, 12, 13, 14, 15, 16,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32
];
const SYNTHETIC_CHILD_JOINTS = {
  15: [17, 19, 21],
  16: [18, 20, 22],
  27: [29, 31],
  28: [30, 32]
};

function createSyntheticPose() {
  const points = Array.from({ length: 33 }, (_, index) => ({
    index,
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1
  }));
  const positions = {
    0: [0.5, 0.14],
    1: [0.485, 0.13], 2: [0.475, 0.13], 3: [0.465, 0.135],
    4: [0.515, 0.13], 5: [0.525, 0.13], 6: [0.535, 0.135],
    7: [0.445, 0.15], 8: [0.555, 0.15],
    9: [0.48, 0.18], 10: [0.52, 0.18],
    11: [0.4, 0.29], 12: [0.6, 0.29],
    13: [0.34, 0.43], 14: [0.66, 0.43],
    15: [0.43, 0.5], 16: [0.57, 0.5],
    17: [0.415, 0.515], 18: [0.585, 0.515],
    19: [0.425, 0.52], 20: [0.575, 0.52],
    21: [0.44, 0.515], 22: [0.56, 0.515],
    23: [0.44, 0.56], 24: [0.56, 0.56],
    25: [0.43, 0.75], 26: [0.57, 0.75],
    27: [0.42, 0.92], 28: [0.58, 0.92],
    29: [0.4, 0.94], 30: [0.6, 0.94],
    31: [0.44, 0.95], 32: [0.56, 0.95]
  };
  Object.entries(positions).forEach(([index, [x, y]]) => {
    Object.assign(points[Number(index)], { x, y });
  });
  return points;
}

function interpolatePoint(openPoint, closedPoint, closure) {
  return {
    x: openPoint.x + (closedPoint.x - openPoint.x) * closure,
    y: openPoint.y + (closedPoint.y - openPoint.y) * closure,
    z: 0,
    visibility: 1
  };
}

function createSyntheticHand(wrist, side, closurePercent) {
  const closure = Math.max(0, Math.min(100, closurePercent)) / 100;
  const direction = side === "left" ? -1 : 1;
  const hand = Array.from({ length: 21 }, () => ({
    x: wrist.x,
    y: wrist.y,
    z: 0,
    visibility: 1
  }));
  const fingerGroups = [
    { indices: [5, 6, 7, 8], offset: -0.024 },
    { indices: [9, 10, 11, 12], offset: -0.008 },
    { indices: [13, 14, 15, 16], offset: 0.008 },
    { indices: [17, 18, 19, 20], offset: 0.024 }
  ];

  hand[0] = { ...wrist, visibility: 1 };
  hand[1] = { x: wrist.x + direction * 0.014, y: wrist.y - 0.004, z: 0, visibility: 1 };
  hand[2] = { x: wrist.x + direction * 0.026, y: wrist.y - 0.012, z: 0, visibility: 1 };
  hand[3] = interpolatePoint(
    { x: wrist.x + direction * 0.04, y: wrist.y - 0.024 },
    { x: wrist.x + direction * 0.018, y: wrist.y + 0.002 },
    closure
  );
  hand[4] = interpolatePoint(
    { x: wrist.x + direction * 0.055, y: wrist.y - 0.034 },
    { x: wrist.x + direction * 0.008, y: wrist.y + 0.008 },
    closure
  );

  fingerGroups.forEach(({ indices, offset }) => {
    const closedShape = [
      { xScale: 1, y: -0.022 },
      { xScale: 1.15, y: -0.005 },
      { xScale: 0.65, y: 0.008 },
      { xScale: 0.95, y: -0.014 }
    ];
    indices.forEach((landmarkIndex, segmentIndex) => {
      const openPoint = {
        x: wrist.x + direction * offset,
        y: wrist.y - 0.024 - segmentIndex * 0.028
      };
      const closedPoint = {
        x: wrist.x + direction * offset * closedShape[segmentIndex].xScale,
        y: wrist.y + closedShape[segmentIndex].y
      };
      hand[landmarkIndex] = interpolatePoint(openPoint, closedPoint, closure);
    });
  });

  return hand;
}
import {
  applyStudioPerformanceMode,
  getAdaptiveSmoothing,
  getStudioPerformanceConfig
} from "../performance/studioPerformanceConfig";
import { WS_BASE_URL } from "../services/api";
import { getBodyCalibrationSample, getCalibrationFit } from "../utils/bodyCalibration";
import { assignHandSides } from "../utils/handSideAssignment";
import {
  getTechniqueFromCatalog,
  getTechniqueTrackingPackage
} from "../data/techniqueCatalog";
import {
  SESSION_STATES,
  TrackingSessionEngine
} from "../tracking/trackingSessionEngine";

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
  rawPoseLandmarks,
  poseLandmarks,
  angleLandmarks,
  handLandmarksList,
  handednessList,
  faceLandmarks
}) {
  const handEntries = getHandEntries(handLandmarksList, poseLandmarks, handednessList);

  return {
    timestamp,
    rawPose: rawPoseLandmarks || poseLandmarks,
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
  measurementParts,
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
  onRuleEngineSessionComplete,
  onLandmarkFrame,
  temporalCue,
  temporalSessionId,
  trackingSessionActive = true,
  trackingSessionPaused = false,
  bodyCalibration,
  calibrationActive = false,
  onBodyCalibrationSample,
  onCalibrationStatus,
  stanceTargetDegrees = 0,
  enableAwareness = false,
  performanceProfile = "student",
  performanceMode = "auto",
  inputSource = "live",
  inputVideoUrl = null,
  inputVideoName = null,
  onInputStatus
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
  const measurementPartsRef = useRef(measurementParts || requiredParts);
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
  const predictionLedgerRef = useRef(new PredictionLedger());
  const situationAwarenessRef = useRef(new SituationAwarenessLayer());
  const trackingSessionEngineRef = useRef(null);
  const trackingSessionActiveRef = useRef(trackingSessionActive);
  const trackingSessionPausedRef = useRef(trackingSessionPaused);
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
  const onRuleEngineSessionCompleteRef = useRef(onRuleEngineSessionComplete);
  const onLandmarkFrameRef = useRef(onLandmarkFrame);
  const stanceTargetDegreesRef = useRef(stanceTargetDegrees);
  const lastCalibrationStatusTimeRef = useRef(0);
  const lastLevel1UpdateTimeRef = useRef(0);
  const lastLevel2UpdateTimeRef = useRef(0);
  const lastLevel3UpdateTimeRef = useRef(0);
  const lastLevel4UpdateTimeRef = useRef(0);
  const lastSituationAwarenessUpdateTimeRef = useRef(0);
  const [syntheticPose, setSyntheticPose] = useState(createSyntheticPose);
  const syntheticPoseRef = useRef(syntheticPose);
  const [syntheticHandClosure, setSyntheticHandClosure] = useState({
    left: 85,
    right: 85
  });
  const syntheticHandClosureRef = useRef(syntheticHandClosure);
  const draggedSyntheticJointRef = useRef(null);

  const moveSyntheticJoint = useCallback((event) => {
    const jointIndex = draggedSyntheticJointRef.current;
    if (!Number.isFinite(jointIndex)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const displayedX = Math.max(
      0.02,
      Math.min(0.98, (event.clientX - bounds.left) / Math.max(bounds.width, 1))
    );
    const y = Math.max(
      0.02,
      Math.min(0.98, (event.clientY - bounds.top) / Math.max(bounds.height, 1))
    );
    const x = displayMirrored ? 1 - displayedX : displayedX;
    setSyntheticPose((current) => {
      const previous = current[jointIndex];
      const deltaX = x - previous.x;
      const deltaY = y - previous.y;
      const childJoints = new Set(SYNTHETIC_CHILD_JOINTS[jointIndex] || []);
      const next = current.map((point, index) => {
        if (index === jointIndex) return { ...point, x, y };
        if (childJoints.has(index)) {
          return {
            ...point,
            x: Math.max(0.02, Math.min(0.98, point.x + deltaX)),
            y: Math.max(0.02, Math.min(0.98, point.y + deltaY))
          };
        }
        return point;
      });
      syntheticPoseRef.current = next;
      return next;
    });
  }, [displayMirrored]);

  const updateSyntheticHandClosure = useCallback((side, value) => {
    const closure = Math.max(0, Math.min(100, Number(value) || 0));
    setSyntheticHandClosure((current) => {
      const next = { ...current, [side]: closure };
      syntheticHandClosureRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const technique = getTechniqueFromCatalog({
      techniqueName: sessionConfig?.technique_name
    });
    const techniquePackage = getTechniqueTrackingPackage(technique);
    if (!techniquePackage) {
      trackingSessionEngineRef.current = null;
      return undefined;
    }

    const engine = new TrackingSessionEngine(techniquePackage, {
      mode: sessionConfig?.mode || (enableCoach ? "train" : "practice")
    });
    if (trackingSessionActiveRef.current) {
      engine.start(performance.now());
      if (trackingSessionPausedRef.current) {
        engine.pause(performance.now());
      }
    }
    trackingSessionEngineRef.current = engine;

    return () => {
      engine.end(performance.now());
      if (trackingSessionEngineRef.current === engine) {
        trackingSessionEngineRef.current = null;
      }
    };
  }, [enableCoach, sessionConfig?.mode, sessionConfig?.technique_name]);

  useEffect(() => {
    trackingSessionActiveRef.current = trackingSessionActive;
    const engine = trackingSessionEngineRef.current;
    if (!engine) return;

    if (trackingSessionActive) {
      if (engine.sessionState === SESSION_STATES.SESSION_COMPLETE) {
        engine.reset();
      }
      engine.start(performance.now());
    } else if (
      ![
        SESSION_STATES.OUTSIDE_SESSION,
        SESSION_STATES.SESSION_COMPLETE
      ].includes(engine.sessionState)
    ) {
      const summary = engine.end(performance.now());
      onRuleEngineSessionCompleteRef.current?.(summary);
    }
  }, [trackingSessionActive]);

  useEffect(() => {
    trackingSessionPausedRef.current = trackingSessionPaused;
    const engine = trackingSessionEngineRef.current;
    if (!engine || !trackingSessionActiveRef.current) return;
    if (trackingSessionPaused) {
      engine.pause(performance.now());
    } else {
      engine.resume(performance.now());
    }
  }, [trackingSessionPaused]);

  useEffect(() => {
    if (!temporalCue?.cue || !Number.isFinite(temporalCue.timestampMs)) return;
    level3SessionRef.current.recordCue({
      cue: temporalCue.cue,
      timestampMs: temporalCue.timestampMs
    });
    trackingSessionEngineRef.current?.recordCue({
      cue: temporalCue.cue,
      timestampMs: temporalCue.timestampMs
    });
  }, [temporalCue]);

  useEffect(() => {
    if (temporalSessionId === null || temporalSessionId === undefined) return;
    level3SessionRef.current.reset();
    trackingSessionEngineRef.current?.reset();
    if (trackingSessionActiveRef.current) {
      trackingSessionEngineRef.current?.start(performance.now());
    }
  }, [temporalSessionId]);

  useEffect(() => {
    previousPoseRef.current = null;
    previousWorldPoseRef.current = null;
    previousDisplayPoseRef.current = null;
    previousHandsRef.current = null;
    previousHandednessRef.current = null;
    previousFaceRef.current = null;
    level1MotionRef.current = new Level1MotionLayer();
    level2ActionRef.current = new Level2ActionLayer(performanceConfigRef.current);
    predictionLedgerRef.current.reset();
    trackingSessionEngineRef.current?.reset();
    if (trackingSessionActiveRef.current) {
      trackingSessionEngineRef.current?.start(performance.now());
    }
  }, [inputSource, inputVideoUrl]);

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
    measurementPartsRef.current = measurementParts || requiredParts;
    sessionConfigRef.current = sessionConfig;
    enableAwarenessRef.current = enableAwareness;
    displayMirroredRef.current = displayMirrored;
    skeletonLayersRef.current = skeletonLayers;
    performanceModeRef.current = performanceMode;
    basePerformanceConfigRef.current = getStudioPerformanceConfig(performanceProfile, {
      onnxEnabled: Boolean(skeletonLayers?.onnx || onLandmarkFrame)
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
      shouldTrackHands(requiredParts, currentStepName) ||
      Boolean(onLandmarkFrame);
    shouldTrackFaceRef.current = Boolean(
      onLandmarkFrame ||
      (enableAwareness && performanceConfigRef.current.enableFace)
    );
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
    measurementParts,
    skeletonLayers,
    sessionConfig,
    performanceProfile,
    performanceMode,
    onLandmarkFrame
  ]);

  useEffect(() => {
    predictionLedgerRef.current.reset();
  }, [sessionConfig?.technique_name]);

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
    onRuleEngineSessionCompleteRef.current = onRuleEngineSessionComplete;
    onLandmarkFrameRef.current = onLandmarkFrame;
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
    onRuleEngineSessionComplete,
    onLandmarkFrame,
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
    const videoElement = videoRef.current;

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
        !canvasRef.current ||
        (
          inputSource !== "skeleton" &&
          (
            !videoRef.current ||
            (
              videoRef.current.readyState < 2 &&
              (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)
            )
          )
        )
      ) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (inputSource === "video" && videoRef.current.paused) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (inputSource === "skeleton") {
        const pixelRatio = window.devicePixelRatio || 1;
        canvasRef.current.width = Math.max(
          1,
          Math.round(canvasRef.current.clientWidth * pixelRatio)
        );
        canvasRef.current.height = Math.max(
          1,
          Math.round(canvasRef.current.clientHeight * pixelRatio)
        );
      } else {
        syncCanvasToVideo(canvasRef.current, videoRef.current);
      }

      if (now - lastFrameTimeRef.current < 1000 / performanceConfigRef.current.poseFps) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      lastFrameTimeRef.current = now;
      const performanceConfig = performanceConfigRef.current;
      const processingStartedAt = performance.now();

      try {
        let rawPoseLandmarks = null;
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

      if (inputSource === "skeleton") {
        rawPoseLandmarks = syntheticPoseRef.current.map((point) => ({ ...point }));
        poseLandmarks = rawPoseLandmarks;
        angleLandmarks = rawPoseLandmarks;
        handLandmarksList = [
          createSyntheticHand(
            rawPoseLandmarks[15],
            "left",
            syntheticHandClosureRef.current.left
          ),
          createSyntheticHand(
            rawPoseLandmarks[16],
            "right",
            syntheticHandClosureRef.current.right
          )
        ];
        handednessList = [];
      } else if (poseRef.current) {
        const result = poseRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          rawPoseLandmarks = result.landmarks[0].map((point) => ({ ...point }));
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
          rawPoseLandmarks,
          poseLandmarks,
          angleLandmarks,
          handLandmarksList,
          handednessList,
          faceLandmarks
        });
        const baseLevel1State = level1MotionRef.current.update(frame.pose, now);
        const auxiliaryScores = getHolisticScores(
          frame,
          shouldTrackHandsRef.current,
          shouldTrackFaceRef.current
        );
        const level1State = {
          ...baseLevel1State,
          motion_context: {
            ...(baseLevel1State?.motion_context || {}),
            auxiliary_features: auxiliaryScores
          }
        };
        const ruleEngineShadowFrame = trackingSessionActiveRef.current
          ? trackingSessionEngineRef.current?.update(level1State) || null
          : trackingSessionEngineRef.current?.latestFrame || null;
        const level2State = level2ActionRef.current.update({
          level1State,
          requiredParts: requiredPartsRef.current,
          currentStepId: currentStepIdRef.current,
          currentStepName: currentStepNameRef.current,
          techniqueName: sessionConfigRef.current?.technique_name
        });
        predictionLedgerRef.current.addSequence({
          model: "level1",
          originTimestampMs: now,
          forecasts: level1State?.debug?.predictedFrames || [],
          confidence: level1State?.motion_context?.prediction_confidence || 0
        });
        const level2Prediction = level2State?.debug?.onnxPrediction;
        predictionLedgerRef.current.addSequence({
          model: "level2",
          originTimestampMs: level2Prediction?.origin_timestamp_ms,
          forecasts: level2Prediction?.future_landmark_frames || [],
          confidence: level2State?.action_context?.prediction_confidence || 0
        });
        const predictionAggregate = predictionLedgerRef.current.resolve({
          targetTimestampMs: now,
          observedLandmarks: level1State?.debug?.currentLandmarks || frame.pose,
          observedConfidence: level1State?.tracking?.confidence || 0
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
        const level3UiState = ruleEngineShadowFrame && level3State
          ? {
              ...level3State,
              debug: {
                ...level3State.debug,
                rule_engine_shadow: {
                  frame: ruleEngineShadowFrame,
                  summary: trackingSessionEngineRef.current?.getSummary()
                }
              }
            }
          : level3State;
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
        const anglesPayload = { ...auxiliaryScores };

        measurementPartsRef.current?.forEach((part) => {
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
          onLevel3UpdateRef.current(level3UiState);
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

        const displayPoseSelection = selectPredictionAwareDisplayPose(
          predictionAggregate
        );
        const skeletonSource =
          displayPoseSelection.landmarks?.length
            ? displayPoseSelection.landmarks
            : level1State?.debug?.currentLandmarks || frame.pose;
        const displayLandmarks = stabilizeDisplayLandmarks(
          skeletonSource,
          previousDisplayPoseRef.current,
          level2State?.action_context?.motion_energy ?? 0
        );
        previousDisplayPoseRef.current = displayLandmarks;

        onLandmarkFrameRef.current?.({
          timestamp: now,
          pose: displayLandmarks,
          observedPose: frame.rawPose,
          filteredPose: level1State?.debug?.currentLandmarks || frame.pose,
          measurementPose: frame.worldPose,
          aggregatePose: predictionAggregate.aggregateLandmarks,
          facePoints: frame.face
            ? getFaceDetailPoints(frame.face)
            : getPoseFaceDetailPoints(frame.pose),
          faceSource: frame.face ? "mesh" : "pose33",
          handPoints: getHandDetailPoints(frame.handEntries, frame.pose),
          motionEnergy: level2State?.action_context?.motion_energy ?? 0,
          trackingConfidence: level1State?.tracking?.confidence ?? 0,
          predictionAggregate,
          displayPoseSource: displayPoseSelection.source,
          angles: anglesPayload
        });

        if (
          inputSource === "skeleton" ||
          skeletonLayersRef.current.live === false
        ) {
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
      onInputStatus?.("Requesting camera access");
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

      onInputStatus?.("Live camera active");
      detect();
    };

    const startUploadedVideo = async () => {
      if (!videoRef.current || !inputVideoUrl) {
        onInputStatus?.("Choose a local video to begin");
        return;
      }

      videoRef.current.srcObject = null;
      videoRef.current.src = inputVideoUrl;
      videoRef.current.loop = false;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.onended = () => {
        onInputStatus?.(`Video finished: ${inputVideoName || "uploaded sample"}`);
      };
      await waitForVideoMetadata(videoRef.current);
      if (isDisposed || !videoRef.current) return;

      await videoRef.current.play();
      syncCanvasToVideo(canvasRef.current, videoRef.current);
      onInputStatus?.(`Analyzing video: ${inputVideoName || "uploaded sample"}`);
      detect();
    };

    const init = async () => {
      if (inputSource === "skeleton") {
        onInputStatus?.("Skeleton Lab active · drag a joint");
        detect();
        return;
      }

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

      try {
        if (inputSource === "video") {
          await startUploadedVideo();
        } else {
          await startCamera();
        }
      } catch (error) {
        console.error("Studio input source failed", error);
        onInputStatus?.(
          inputSource === "video"
            ? "Video could not play in this browser"
            : "Camera unavailable or permission denied"
        );
      }
    };

    init();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      cameraStream?.getTracks().forEach((track) => track.stop());
      if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement.onended = null;
        videoElement.removeAttribute("src");
        videoElement.load();
      }
      poseRef.current?.close?.();
      handRef.current?.close?.();
      faceRef.current?.close?.();
      poseRef.current = null;
      handRef.current = null;
      faceRef.current = null;
      visionRef.current = null;
    };
  }, [inputSource, inputVideoName, inputVideoUrl, onInputStatus]);

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

  const displayedSyntheticHands = inputSource === "skeleton"
    ? [
        createSyntheticHand(
          syntheticPose[15],
          "left",
          syntheticHandClosure.left
        ),
        createSyntheticHand(
          syntheticPose[16],
          "right",
          syntheticHandClosure.right
        )
      ]
    : [];

  return (
    <div
      className={`skeleton-canvas ${
        displayMirrored ? "skeleton-canvas--mirrored" : ""
      } ${inputSource === "skeleton" ? "skeleton-canvas--synthetic" : ""}`}
    >
      <video aria-hidden="true" ref={videoRef} autoPlay muted playsInline />
      <canvas ref={canvasRef} />
      {inputSource === "skeleton" ? (
        <div className="synthetic-skeleton-editor">
          <div className="synthetic-skeleton-editor__hint">
            <strong>Skeleton Lab</strong>
            <span>Drag the glowing joints to create movement</span>
          </div>
          <div className="synthetic-skeleton-editor__controls">
            {["left", "right"].map((side) => (
              <label key={side}>
                <span>{side} fist</span>
                <input
                  aria-label={`${side} fist closure`}
                  max="100"
                  min="0"
                  onChange={(event) =>
                    updateSyntheticHandClosure(side, event.target.value)
                  }
                  type="range"
                  value={syntheticHandClosure[side]}
                />
                <output>{syntheticHandClosure[side]}%</output>
              </label>
            ))}
            <small>Feet: drag each heel and toe point independently.</small>
          </div>
          <svg
            aria-label="Draggable evaluation skeleton"
            onPointerCancel={() => {
              draggedSyntheticJointRef.current = null;
            }}
            onPointerMove={moveSyntheticJoint}
            onPointerUp={() => {
              draggedSyntheticJointRef.current = null;
            }}
            role="application"
            viewBox="0 0 1000 1000"
          >
            {SYNTHETIC_CONNECTIONS.map(([fromIndex, toIndex]) => {
              const from = syntheticPose[fromIndex];
              const to = syntheticPose[toIndex];
              return (
                <line
                  key={`${fromIndex}-${toIndex}`}
                  x1={(displayMirrored ? 1 - from.x : from.x) * 1000}
                  x2={(displayMirrored ? 1 - to.x : to.x) * 1000}
                  y1={from.y * 1000}
                  y2={to.y * 1000}
                />
              );
            })}
            {displayedSyntheticHands.flatMap((hand, handIndex) =>
              SYNTHETIC_HAND_CONNECTIONS.map(([fromIndex, toIndex]) => {
                const from = hand[fromIndex];
                const to = hand[toIndex];
                return (
                  <line
                    className="is-hand"
                    key={`hand-${handIndex}-${fromIndex}-${toIndex}`}
                    x1={(displayMirrored ? 1 - from.x : from.x) * 1000}
                    x2={(displayMirrored ? 1 - to.x : to.x) * 1000}
                    y1={from.y * 1000}
                    y2={to.y * 1000}
                  />
                );
              })
            )}
            {SYNTHETIC_DRAGGABLE_JOINTS.map((jointIndex) => {
              const point = syntheticPose[jointIndex];
              return (
                <circle
                  aria-label={`Move landmark ${jointIndex}`}
                  cx={(displayMirrored ? 1 - point.x : point.x) * 1000}
                  cy={point.y * 1000}
                  key={jointIndex}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    draggedSyntheticJointRef.current = jointIndex;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  r="13"
                  role="slider"
                />
              );
            })}
          </svg>
        </div>
      ) : null}
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
