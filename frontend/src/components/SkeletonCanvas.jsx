import { useCallback, useEffect, useRef } from "react";
import {
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";

import { drawSkeleton } from "../utils/drawSkeleton";
import { WS_BASE_URL } from "../services/api";

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

const POSE_FPS = 16;
const HAND_INTERVAL_MS = 220;
const FACE_INTERVAL_MS = 500;
const MAX_HAND_STALE_MS = 700;
const MAX_FACE_STALE_MS = 1200;
const AWARENESS_INTERVAL_MS = 300;
const COACH_SEND_INTERVAL_MS = 180;
const MIN_LANDMARK_VISIBILITY = 0.45;
const HAND_TRACKING_KEYWORDS = ["fist", "punch", "jab", "cross", "guard", "hand"];

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

function shouldTrackHands(requiredParts = [], stepName = "") {
  const hasHandTarget = requiredParts.some((part) =>
    /fist|hand|wrist/i.test(part.body_part)
  );
  const hasHandStepName = HAND_TRACKING_KEYWORDS.some((keyword) =>
    stepName.toLowerCase().includes(keyword)
  );

  return hasHandTarget || hasHandStepName;
}

function getHandEntries(handLandmarksList, poseLandmarks, handednessList = []) {
  if (!handLandmarksList?.length) return [];

  const leftWrist = poseLandmarks?.[15];
  const rightWrist = poseLandmarks?.[16];
  const canUsePoseWrists = leftWrist && rightWrist;
  const entries = handLandmarksList.map((hand, index) => {
    const handednessLabel =
      handednessList?.[index]?.[0]?.categoryName?.toLowerCase?.() || "";

    if (!canUsePoseWrists) {
      return {
        hand,
        side: handednessLabel === "left" ? "left" : "right",
        confidence: 1
      };
    }

    const handWrist = hand[0];
    const leftDistance = distance(handWrist, leftWrist);
    const rightDistance = distance(handWrist, rightWrist);

    return {
      hand,
      side: leftDistance <= rightDistance ? "left" : "right",
      confidence: Math.abs(leftDistance - rightDistance)
    };
  });
  const usedSides = new Set();

  return entries
    .sort((first, second) => second.confidence - first.confidence)
    .map((entry) => {
      if (!usedSides.has(entry.side)) {
        usedSides.add(entry.side);
        return entry;
      }

      const fallbackSide = entry.side === "left" ? "right" : "left";
      usedSides.add(fallbackSide);
      return { ...entry, side: fallbackSide };
    });
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

function getHandAwareness(handLandmarksList, poseLandmarks, handednessList) {
  const hands = {
    left: { visible: false, fistScore: null, state: "Not visible" },
    right: { visible: false, fistScore: null, state: "Not visible" }
  };

  getHandEntries(handLandmarksList, poseLandmarks, handednessList).forEach(({ hand, side }) => {
    const fistScore = getFistScore(hand);

    hands[side] = {
      visible: true,
      fistScore,
      openScore: 100 - fistScore,
      state: fistScore >= 70 ? "Closed fist" : fistScore <= 35 ? "Open hand" : "Half closed"
    };
  });

  return hands;
}

function getHandScores(handLandmarksList, poseLandmarks, handednessList) {
  const awareness = getHandAwareness(handLandmarksList, poseLandmarks, handednessList);
  const scores = {};

  ["left", "right"].forEach((side) => {
    const hand = awareness[side];

    if (!hand?.visible) return;

    scores[`fist_${side}`] = hand.fistScore;
    scores[`hand_${side}_open`] = hand.openScore;
  });

  return scores;
}

function getFaceAwareness(faceLandmarks) {
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
  const horizontal = nose.x < eyeCenter.x - eyeWidth * 0.08
    ? "Turned right"
    : nose.x > eyeCenter.x + eyeWidth * 0.08
      ? "Turned left"
      : "Forward";
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

function getHandDetailPoints(handEntries = []) {
  return handEntries.reduce((details, entry) => {
    details[entry.side] = entry.hand.map((point, index) => ({
      index,
      x: point.x,
      y: point.y
    }));
    return details;
  }, {});
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

  if (includeFace) {
    Object.assign(scores, getFaceScores(frame.face));
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
  enableAwareness = false
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
  const lastAnglePayloadRef = useRef({});
  const lastCommandIdRef = useRef(null);
  const pendingCommandRef = useRef(null);
  const currentStepIdRef = useRef(currentStepId);
  const currentStepNameRef = useRef(currentStepName);
  const requiredPartsRef = useRef(requiredParts);
  const sessionConfigRef = useRef(sessionConfig);
  const shouldTrackHandsRef = useRef(false);
  const enableAwarenessRef = useRef(enableAwareness);
  const displayMirroredRef = useRef(displayMirrored);
  const handModelPromiseRef = useRef(null);
  const faceModelPromiseRef = useRef(null);

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
    requiredPartsRef.current = requiredParts;
    sessionConfigRef.current = sessionConfig;
    enableAwarenessRef.current = enableAwareness;
    displayMirroredRef.current = displayMirrored;
    shouldTrackHandsRef.current = enableAwareness || shouldTrackHands(requiredParts, currentStepName);

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
    sessionConfig
  ]);

  useEffect(() => {
    if (!enableCoach) {
      return undefined;
    }

    const token = localStorage.getItem("token");
    wsRef.current = new WebSocket(`${WS_BASE_URL}/ws/train?token=${token}`);

    wsRef.current.onopen = () => {
      wsRef.current.send(
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

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      onAccuracyUpdate(data.accuracy);
      onFeedbackUpdate(data.feedback?.join("\n") || data.message || "");

      if (data.summary && onSummaryUpdate) {
        onSummaryUpdate(data.summary);
      }

      if (onCoachEvent) {
        onCoachEvent(data);
      }
    };

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [
    enableCoach,
    onAccuracyUpdate,
    onCoachEvent,
    onFeedbackUpdate,
    onSummaryUpdate,
    sendCoachCommand
  ]);

  useEffect(() => {
    let animationFrameId;
    let cameraStream;
    let isDisposed = false;

    const smoothing = 0.6;

    const smoothLandmarks = (current, previous) => {
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
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
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
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
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
        now - lastCoachSendTimeRef.current < COACH_SEND_INTERVAL_MS
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
      onAngleUpdate(anglesPayload);
    };

    const detect = () => {
      const now = performance.now();

      if (isDisposed || document.hidden) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (
        !videoRef.current ||
        videoRef.current.videoWidth === 0 ||
        videoRef.current.videoHeight === 0
      ) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (now - lastFrameTimeRef.current < 1000 / POSE_FPS) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      lastFrameTimeRef.current = now;

      let poseLandmarks = null;
      let angleLandmarks = null;
      const hasFreshHands =
        shouldTrackHandsRef.current &&
        previousHandsRef.current &&
        now - lastHandSeenTimeRef.current <= MAX_HAND_STALE_MS;
      const hasFreshFace =
        enableAwarenessRef.current &&
        previousFaceRef.current &&
        now - lastFaceSeenTimeRef.current <= MAX_FACE_STALE_MS;
      let handLandmarksList = hasFreshHands ? previousHandsRef.current : null;
      let handednessList = hasFreshHands ? previousHandednessRef.current : null;
      let faceLandmarks = hasFreshFace ? previousFaceRef.current : null;

      if (poseRef.current) {
        const result = poseRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          poseLandmarks = smoothLandmarks(
            result.landmarks[0],
            previousPoseRef.current
          );

          previousPoseRef.current = poseLandmarks;

          if (result.worldLandmarks?.length > 0) {
            angleLandmarks = smoothLandmarks(
              result.worldLandmarks[0],
              previousWorldPoseRef.current
            );

            previousWorldPoseRef.current = angleLandmarks;
          } else {
            angleLandmarks = poseLandmarks;
          }
        }
      }

      if (
        shouldTrackHandsRef.current &&
        !handRef.current &&
        !handModelPromiseRef.current
      ) {
        ensureHandLandmarker();
      }

      if (
        enableAwarenessRef.current &&
        !faceRef.current &&
        !faceModelPromiseRef.current
      ) {
        ensureFaceLandmarker();
      }

      if (
        shouldTrackHandsRef.current &&
        handRef.current &&
        now - lastHandTimeRef.current > HAND_INTERVAL_MS
      ) {
        lastHandTimeRef.current = now;
        const result = handRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          handLandmarksList = result.landmarks.map((hand, index) =>
            smoothLandmarks(hand, previousHandsRef.current?.[index])
          );
          handednessList = result.handedness || [];
          previousHandsRef.current = handLandmarksList;
          previousHandednessRef.current = handednessList;
          lastHandSeenTimeRef.current = now;
        } else if (now - lastHandSeenTimeRef.current > MAX_HAND_STALE_MS) {
          handLandmarksList = null;
          handednessList = null;
          previousHandsRef.current = null;
          previousHandednessRef.current = null;
        }
      }

      if (
        enableAwarenessRef.current &&
        faceRef.current &&
        now - lastFaceTimeRef.current > FACE_INTERVAL_MS
      ) {
        lastFaceTimeRef.current = now;
        const result = faceRef.current.detectForVideo(videoRef.current, now);

        if (result.faceLandmarks.length > 0) {
          faceLandmarks = result.faceLandmarks[0];
          previousFaceRef.current = faceLandmarks;
          lastFaceSeenTimeRef.current = now;
        } else if (now - lastFaceSeenTimeRef.current > MAX_FACE_STALE_MS) {
          faceLandmarks = null;
          previousFaceRef.current = null;
        }
      }

      if (poseLandmarks) {
        const frame = createLandmarkFrame({
          timestamp: now,
          poseLandmarks,
          angleLandmarks,
          handLandmarksList,
          handednessList,
          faceLandmarks
        });
        const anglesPayload = getHolisticScores(
          frame,
          shouldTrackHandsRef.current,
          enableAwarenessRef.current
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

        drawSkeleton(
          canvasRef.current,
          frame.pose,
          getCorrectionParts(requiredPartsRef.current, anglesPayload),
          { mirrored: displayMirroredRef.current }
        );

        emitAngleUpdate(anglesPayload);
        sendCoachFrame(anglesPayload);

        if (
          enableAwarenessRef.current &&
          onAwarenessUpdate &&
          now - lastAwarenessTimeRef.current > AWARENESS_INTERVAL_MS
        ) {
          lastAwarenessTimeRef.current = now;
          onAwarenessUpdate({
            active: true,
            face: getFaceAwareness(frame.face),
            facePoints: getFaceDetailPoints(frame.face),
            handPoints: getHandDetailPoints(frame.handEntries),
            hands: getHandAwareness(frame.hands, frame.pose, frame.handedness)
          });
        }
      }

      animationFrameId = requestAnimationFrame(detect);
    };

    const startCamera = async () => {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 }
        }
      });

      videoRef.current.srcObject = cameraStream;

      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = resolve;
      });

      await videoRef.current.play();

      canvasRef.current.width = videoRef.current.videoWidth || 640;
      canvasRef.current.height = videoRef.current.videoHeight || 480;

      detect();
    };

    const init = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      visionRef.current = vision;

      poseRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
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
  }, [
    onAngleUpdate,
    onAwarenessUpdate
  ]);

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
    <div className="skeleton-canvas">
      <canvas ref={canvasRef} />
      <div className="skeleton-canvas__overlay" />
      <video ref={videoRef} autoPlay muted playsInline />
    </div>
  );
}
