import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { StgatOnnxPredictor } from "../temporal/stgatOnnxPredictor";
import { drawSkeleton } from "../utils/drawSkeleton";

const MAX_FRAMES = 45;

export default function ModelTestPage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null);
  const framesRef = useRef([]);
  const predictorRef = useRef(null);
  const lastPredictionRef = useRef(null);
  const lastUiUpdateRef = useRef(0);

  const [status, setStatus] = useState("Preparing camera and model...");
  const [error, setError] = useState("");
  const [predictionStatus, setPredictionStatus] = useState("waiting");
  const [frameCount, setFrameCount] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    const start = async () => {
      try {
        setStatus("Loading pose detector...");

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        if (isCancelled) return;

        poseRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });

        predictorRef.current = new StgatOnnxPredictor();
        setStatus("Loading ONNX model...");
        await predictorRef.current.load();

        if (isCancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 }
          }
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (isCancelled) return;

        setStatus("Live tracking active");
        setError("");

        const render = () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (!video || !canvas || !poseRef.current) {
            animationFrameRef.current = window.requestAnimationFrame(render);
            return;
          }

          if (video.videoWidth && video.videoHeight) {
            if (canvas.width !== video.videoWidth) {
              canvas.width = video.videoWidth;
            }
            if (canvas.height !== video.videoHeight) {
              canvas.height = video.videoHeight;
            }
          }

          const now = performance.now();
          const result = poseRef.current.detectForVideo(video, now);

          if (result.landmarks?.length) {
            const landmarks = result.landmarks[0];
            framesRef.current = [...framesRef.current.slice(-(MAX_FRAMES - 1)), { landmarks }];
            setFrameCount(framesRef.current.length);

            predictorRef.current?.update({
              frames: framesRef.current,
              currentLandmarks: landmarks,
              actionContext: { attention_prediction_horizon_ms: 300 }
            });

            const prediction = predictorRef.current?.latestPrediction;
            const visiblePredictionLandmarks = prediction?.landmarks || lastPredictionRef.current;

            if (visiblePredictionLandmarks) {
              lastPredictionRef.current = visiblePredictionLandmarks;
            }

            drawSkeleton(canvas, landmarks, new Set(), {
              mirrored: true,
              attentionPredictedLandmarks: visiblePredictionLandmarks,
              attentionPredictionSource: prediction?.source || "onnx"
            });

            if (now - lastUiUpdateRef.current > 220) {
              lastUiUpdateRef.current = now;
              setPredictionStatus(
                prediction?.status === "run_failed" && lastPredictionRef.current
                  ? "using_last_prediction"
                  : prediction?.status || "waiting"
              );
            }
          } else {
            drawSkeleton(canvas, null, new Set(), { mirrored: true });
          }

          animationFrameRef.current = window.requestAnimationFrame(render);
        };

        animationFrameRef.current = window.requestAnimationFrame(render);
      } catch (err) {
        if (!isCancelled) {
          console.error(err);
          setError(err?.message || "Unable to start the test page.");
          setStatus("Failed to start");
        }
      }
    };

    start();

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      poseRef.current?.close?.();
      poseRef.current = null;
      predictorRef.current = null;
    };
  }, []);

  return (
    <main className="page model-test-page">
      <section className="model-test-shell">
        <div className="model-test-panel model-test-panel--hero">
          <p className="eyebrow">Model test harness</p>
          <h1>Try the motion predictor against your live skeleton</h1>
          <p>
            This page opens your camera, runs the MediaPipe pose detector, and sends the
            live landmarks into the ONNX motion predictor so you can compare the live and
            predicted skeletons side by side.
          </p>
        </div>

        <div className="model-test-grid">
          <div className="model-test-panel">
            <div className="model-test-stage">
              <video ref={videoRef} autoPlay muted playsInline />
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="model-test-panel model-test-panel--info">
            <div className="model-test-status-card">
              <span className="model-test-label">Status</span>
              <strong>{status}</strong>
            </div>

            <div className="model-test-status-card">
              <span className="model-test-label">Model output</span>
              <strong>{predictionStatus}</strong>
            </div>

            <div className="model-test-status-card">
              <span className="model-test-label">Buffered frames</span>
              <strong>{frameCount}</strong>
            </div>

            {error ? <p className="model-test-error">{error}</p> : null}

            <div className="model-test-help">
              <h2>What to expect</h2>
              <ul>
                <li>White skeleton = your live pose from MediaPipe.</li>
                <li>Yellow skeleton = the ONNX model prediction.</li>
                <li>Allow camera access if the browser asks for permission.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
