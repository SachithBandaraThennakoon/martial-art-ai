import { useEffect, useRef } from "react";
import {
  PoseLandmarker,
  HandLandmarker,
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

function calculateAngle(a, b, c) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x);

  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;

  return angle;
}

export default function SkeletonCanvas({
  enableCoach = true,
  currentStepId,
  requiredParts,
  onAngleUpdate,
  onAccuracyUpdate,
  onFeedbackUpdate,
  onSummaryUpdate
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const wsRef = useRef(null);
  const previousPoseRef = useRef(null);
  const previousHandsRef = useRef(null);
  const lastFrameTimeRef = useRef(0);

  useEffect(() => {
    let animationFrameId;
    let cameraStream;

    const smoothing = 0.6;
    const fpsLimit = 25;

    const smoothLandmarks = (current, previous) => {
      if (!previous) return current;

      return current.map((point, index) => ({
        x: previous[index].x * (1 - smoothing) + point.x * smoothing,
        y: previous[index].y * (1 - smoothing) + point.y * smoothing,
        z: previous[index].z * (1 - smoothing) + point.z * smoothing
      }));
    };

    const detect = () => {
      const now = performance.now();

      if (
        !videoRef.current ||
        videoRef.current.videoWidth === 0 ||
        videoRef.current.videoHeight === 0
      ) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      if (now - lastFrameTimeRef.current < 1000 / fpsLimit) {
        animationFrameId = requestAnimationFrame(detect);
        return;
      }

      lastFrameTimeRef.current = now;

      let poseLandmarks = null;
      let handLandmarksList = null;

      if (poseRef.current) {
        const result = poseRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          poseLandmarks = smoothLandmarks(
            result.landmarks[0],
            previousPoseRef.current
          );

          previousPoseRef.current = poseLandmarks;
        }
      }

      if (handRef.current && Math.random() > 0.6) {
        const result = handRef.current.detectForVideo(videoRef.current, now);

        if (result.landmarks.length > 0) {
          handLandmarksList = result.landmarks.map((hand, index) =>
            smoothLandmarks(hand, previousHandsRef.current?.[index])
          );

          previousHandsRef.current = handLandmarksList;
        }
      }

      if (poseLandmarks) {
        drawSkeleton(canvasRef.current, poseLandmarks, handLandmarksList);

        const anglesPayload = {};

        requiredParts?.forEach((part) => {
          const mapping = BODY_PART_MAP[part.body_part];

          if (mapping) {
            const [a, b, c] = mapping;
            anglesPayload[part.body_part] = calculateAngle(
              poseLandmarks[a],
              poseLandmarks[b],
              poseLandmarks[c]
            );
          }
        });

        onAngleUpdate(anglesPayload);

        if (wsRef.current?.readyState === WebSocket.OPEN && currentStepId) {
          wsRef.current.send(
            JSON.stringify({
              step_id: currentStepId,
              angles: anglesPayload
            })
          );
        }
      }

      animationFrameId = requestAnimationFrame(detect);
    };

    const startCamera = async () => {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 960, height: 720 }
      });

      videoRef.current.srcObject = cameraStream;

      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = resolve;
      });

      await videoRef.current.play();

      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;

      detect();
    };

    const init = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      poseRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
        },
        runningMode: "VIDEO",
        numPoses: 1
      });

      handRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
        },
        runningMode: "VIDEO",
        numHands: 2
      });

      if (enableCoach) {
        const token = localStorage.getItem("token");
        wsRef.current = new WebSocket(`${WS_BASE_URL}/ws/train?token=${token}`);

        wsRef.current.onmessage = (event) => {
          const data = JSON.parse(event.data);

          onAccuracyUpdate(data.accuracy);
          onFeedbackUpdate(data.feedback.join("\n"));

          if (data.summary && onSummaryUpdate) {
            onSummaryUpdate(data.summary);
          }
        };
      }

      startCamera();
    };

    init();

    return () => {
      cancelAnimationFrame(animationFrameId);
      wsRef.current?.close();
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [
    currentStepId,
    enableCoach,
    onAccuracyUpdate,
    onAngleUpdate,
    onFeedbackUpdate,
    onSummaryUpdate,
    requiredParts
  ]);

  return (
    <div className="skeleton-canvas">
      <canvas ref={canvasRef} />
      <div className="skeleton-canvas__overlay" />
      <video ref={videoRef} autoPlay muted playsInline />
    </div>
  );
}
