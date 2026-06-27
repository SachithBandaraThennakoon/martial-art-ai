import { useEffect, useRef } from "react";
import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";

import { drawSkeleton } from "../utils/drawSkeleton";

// BODY PART MAP
const BODY_PART_MAP = {
  // 🔹 ELBOWS (Punch mechanics)
  elbow_right: [12, 14, 16],
  elbow_left: [11, 13, 15],

  // 🔹 SHOULDERS (Direction + extension)
  shoulder_right: [14, 12, 24],
  shoulder_left: [13, 11, 23],

  // 🔹 KNEES (Balance)
  knee_right: [24, 26, 28],
  knee_left: [23, 25, 27],

  // 🔹 HIPS (Rotation 🔥)
  hip_right: [12, 24, 26],   // shoulder → hip → knee
  hip_left: [11, 23, 25],

  // 🔹 ANKLES (Ground force)
  ankle_right: [26, 28, 32],
  ankle_left: [25, 27, 31],

  // 🔹 WRISTS (Punch alignment)
  wrist_right: [14, 16, 20],
  wrist_left: [13, 15, 19]
};

function calculateAngle(a, b, c) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x);

  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180) angle = 360 - angle;

  return angle;
}

export default function SkeletonCanvas({
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

  const SMOOTHING = 0.6;
  const FPS_LIMIT = 25;



  // 🔥 THIS IS WHERE YOUR CODE GOES
  useEffect(() => {
    let animationFrameId;

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

      const token = localStorage.getItem("token");

      wsRef.current = new WebSocket(
        `ws://127.0.0.1:8000/ws/train?token=${token}`
      );

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);

        onAccuracyUpdate(data.accuracy);
        onFeedbackUpdate(data.feedback.join("\n"));

        if (data.summary && onSummaryUpdate) {
  onSummaryUpdate(data.summary);
}
      };

      startCamera();
    };

    const startCamera = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });

      videoRef.current.srcObject = stream;

      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = () => {
          resolve();
        };
      });

      await videoRef.current.play();

      // ✅ NOW SAFE
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;

      detect();
    };

    const smoothLandmarks = (current, previous) => {
      if (!previous) return current;

      return current.map((point, i) => ({
        x: previous[i].x * (1 - SMOOTHING) + point.x * SMOOTHING,
        y: previous[i].y * (1 - SMOOTHING) + point.y * SMOOTHING,
        z: previous[i].z * (1 - SMOOTHING) + point.z * SMOOTHING
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

      if (now - lastFrameTimeRef.current < 1000 / FPS_LIMIT) {
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
            smoothLandmarks(
              hand,
              previousHandsRef.current?.[index]
            )
          );

          previousHandsRef.current = handLandmarksList;
        }
      }

      if (poseLandmarks) {
        drawSkeleton(canvasRef.current, poseLandmarks, handLandmarksList);

        let anglesPayload = {};

        requiredParts?.forEach(part => {
          const mapping = BODY_PART_MAP[part.body_part];

          if (mapping) {
            const [a, b, c] = mapping;

            const angle = calculateAngle(
              poseLandmarks[a],
              poseLandmarks[b],
              poseLandmarks[c]
            );

            anglesPayload[part.body_part] = angle;
          }
        });

        onAngleUpdate(anglesPayload);

        if (wsRef.current?.readyState === 1 && currentStepId) {
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

    init();

    return () => {
      cancelAnimationFrame(animationFrameId);
      wsRef.current?.close();
    };
  }, [currentStepId, requiredParts]);

  return (
    <div style={styles.wrapper}>

      <canvas
        ref={canvasRef}
        style={styles.canvas}
      />

      {/* subtle vignette overlay */}
      <div style={styles.overlay}></div>

      <video ref={videoRef} style={{ display: "none" }} autoPlay muted />
    </div>
  );
}


const styles = {
  wrapper: {
    position: "absolute",
    top: 25,
    left: 10,
    width: "100%",
    height: "91%",
    background: "#173f35",
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 1
  },

  canvas: {
    width: "50%",
    height: "100%",
    left: "25%",
    position: "absolute",

    objectFit: "cover",
    background: "#173f35" // 🔥 clean dark (remove green),
  },

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    background:
      "radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.7))"
  }
};