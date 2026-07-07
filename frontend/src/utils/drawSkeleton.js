const BODY_CONNECTIONS = [
  { points: [11, 12], parts: ["shoulder_left", "shoulder_right"] },
  { points: [11, 13], parts: ["shoulder_left", "elbow_left"] },
  { points: [13, 15], parts: ["elbow_left", "wrist_left"] },
  { points: [12, 14], parts: ["shoulder_right", "elbow_right"] },
  { points: [14, 16], parts: ["elbow_right", "wrist_right"] },
  { points: [11, 23], parts: ["shoulder_left", "hip_left"] },
  { points: [12, 24], parts: ["shoulder_right", "hip_right"] },
  { points: [23, 24], parts: ["hip_left", "hip_right"] },
  { points: [23, 25], parts: ["hip_left", "knee_left"] },
  { points: [25, 27], parts: ["knee_left", "ankle_left"] },
  { points: [24, 26], parts: ["hip_right", "knee_right"] },
  { points: [26, 28], parts: ["knee_right", "ankle_right"] }
];

const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const SKELETON_SCALE = 0.7;
const MIN_VISIBILITY = 0.35;
const CORRECTION_RED = "#ff3b3b";
const PREDICTION_YELLOW = "#ffd84a";
const ATTENTION_GREEN = "#60d394";
const FALLBACK_ORANGE = "#ff9f43";

function fitLivePoint(point, mirrored = false) {
  const x = 0.5 + (point.x - 0.5) * SKELETON_SCALE;

  return {
    ...point,
    x: mirrored ? 1 - x : x,
    y: 0.5 + (point.y - 0.5) * SKELETON_SCALE
  };
}

function isVisible(point) {
  return point && (point.visibility == null || point.visibility >= MIN_VISIBILITY);
}

function isDrawablePrediction(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function shouldHighlight(connection, correctionParts) {
  return connection.parts.some((part) => correctionParts.has(part));
}

export function drawSkeleton(
  canvas,
  poseLandmarks,
  correctionParts = new Set(),
  options = {}
) {
  if (!canvas || !poseLandmarks) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const width = canvas.width;
  const height = canvas.height;
  const points = poseLandmarks.map((point) => fitLivePoint(point, options.mirrored));
  const predictedPoints = options.predictedLandmarks?.map((point) =>
    fitLivePoint(point, options.mirrored)
  );
  const attentionPredictedPoints = options.attentionPredictedLandmarks?.map((point) =>
    fitLivePoint(point, options.mirrored)
  );
  const onnxPredictedPoints = options.onnxPredictedLandmarks?.map((point) =>
    fitLivePoint(point, options.mirrored)
  );
  const heuristicPredictedPoints = options.heuristicPredictedLandmarks?.map((point) =>
    fitLivePoint(point, options.mirrored)
  );
  const drawPredictionLayer = (layerPoints, color, shadowColor, lineWidth = 3) => {
    if (!layerPoints) return;

    ctx.shadowBlur = 10;
    ctx.shadowColor = shadowColor;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    BODY_CONNECTIONS.forEach((connection) => {
      const [fromIndex, toIndex] = connection.points;
      const from = layerPoints[fromIndex];
      const to = layerPoints[toIndex];

      if (!isDrawablePrediction(from) || !isDrawablePrediction(to)) return;

      ctx.beginPath();
      ctx.moveTo(from.x * width, from.y * height);
      ctx.lineTo(to.x * width, to.y * height);
      ctx.stroke();
    });

    KEY_JOINTS.forEach((index) => {
      const point = layerPoints[index];

      if (!isDrawablePrediction(point)) return;

      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(255, 255, 255, 0.22)";
  ctx.shadowBlur = 4;

  BODY_CONNECTIONS.forEach((connection) => {
    const [fromIndex, toIndex] = connection.points;
    const from = points[fromIndex];
    const to = points[toIndex];
    const isCorrection = shouldHighlight(connection, correctionParts);

    if (!isVisible(from) || !isVisible(to)) return;

    ctx.strokeStyle = isCorrection ? CORRECTION_RED : "#ffffff";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = isCorrection ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();
  });

  ctx.shadowBlur = 2;
  KEY_JOINTS.forEach((index) => {
    const point = points[index];
    const isCorrection = BODY_CONNECTIONS.some(
      (connection) =>
        connection.points.includes(index) &&
        shouldHighlight(connection, correctionParts)
    );

    if (!isVisible(point)) return;

    ctx.fillStyle = isCorrection ? CORRECTION_RED : "#ffffff";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, isCorrection ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (predictedPoints) {
    drawPredictionLayer(predictedPoints, PREDICTION_YELLOW, "rgba(255, 216, 74, 0.58)", 3);
  }

  const fallbackOrangePoints = options.attentionPredictionSource === "onnx"
    ? heuristicPredictedPoints
    : attentionPredictedPoints;
  drawPredictionLayer(fallbackOrangePoints, FALLBACK_ORANGE, "rgba(255, 159, 67, 0.62)", 3);
  drawPredictionLayer(onnxPredictedPoints, ATTENTION_GREEN, "rgba(96, 211, 148, 0.62)", 3.25);
}
