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
const CORRECT_GREEN = "#60d394";
const PREDICTION_YELLOW = "#ffd84a";
const ACP_PREDICTION_BLUE = "#45a3ff";

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
  const onnxPredictedPoints = options.onnxPredictedLandmarks?.map((point) =>
    fitLivePoint(point, options.mirrored)
  );
  const observedEnabled = options.observedEnabled !== false;
  const correctParts = options.correctParts || new Set();
  const drawPredictionLayer = (
    layerPoints,
    color,
    shadowColor,
    lineWidth = 3,
    dashed = false
  ) => {
    if (!layerPoints) return;

    ctx.save();
    ctx.shadowBlur = dashed ? 16 : 10;
    ctx.shadowColor = shadowColor;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = dashed ? 0.94 : 1;
    ctx.setLineDash(dashed ? [12, 7] : []);

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
      ctx.arc(
        point.x * width,
        point.y * height,
        dashed ? 4.5 : 2.5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
    ctx.restore();
  };

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(255, 255, 255, 0.22)";
  ctx.shadowBlur = 4;

  if (observedEnabled) BODY_CONNECTIONS.forEach((connection) => {
    const [fromIndex, toIndex] = connection.points;
    const from = points[fromIndex];
    const to = points[toIndex];
    const isCorrection = shouldHighlight(connection, correctionParts);
    const isCorrect = !isCorrection && shouldHighlight(connection, correctParts);

    if (!isVisible(from) || !isVisible(to)) return;

    ctx.strokeStyle = isCorrection ? CORRECTION_RED : isCorrect ? CORRECT_GREEN : "#ffffff";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : isCorrect
        ? "rgba(96, 211, 148, 0.55)"
      : "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = isCorrection || isCorrect ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();
  });

  ctx.shadowBlur = 2;
  if (observedEnabled) KEY_JOINTS.forEach((index) => {
    const point = points[index];
    const isCorrection = BODY_CONNECTIONS.some(
      (connection) =>
        connection.points.includes(index) &&
        shouldHighlight(connection, correctionParts)
    );
    const isCorrect = !isCorrection && BODY_CONNECTIONS.some(
      (connection) =>
        connection.points.includes(index) &&
        shouldHighlight(connection, correctParts)
    );

    if (!isVisible(point)) return;

    ctx.fillStyle = isCorrection ? CORRECTION_RED : isCorrect ? CORRECT_GREEN : "#ffffff";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : isCorrect
        ? "rgba(96, 211, 148, 0.55)"
      : "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, isCorrection || isCorrect ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });

  const qualityMarkers = [
    { index: 15, parts: ["fist_left", "hand_left_open"], radius: 6 },
    { index: 16, parts: ["fist_right", "hand_right_open"], radius: 6 },
    {
      index: 0,
      parts: ["face_forward", "eyes_forward", "face_calm"],
      radius: 7
    }
  ];
  if (observedEnabled) qualityMarkers.forEach(({ index, parts, radius }) => {
    const point = points[index];
    if (!isVisible(point)) return;
    const isCorrection = parts.some((part) => correctionParts.has(part));
    const isCorrect =
      !isCorrection && parts.some((part) => correctParts.has(part));
    if (!isCorrection && !isCorrect) return;

    ctx.fillStyle = isCorrection ? CORRECTION_RED : CORRECT_GREEN;
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.65)"
      : "rgba(96, 211, 148, 0.65)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  if (predictedPoints) {
    drawPredictionLayer(predictedPoints, PREDICTION_YELLOW, "rgba(255, 216, 74, 0.58)", 3);
  }

  drawPredictionLayer(
    onnxPredictedPoints,
    ACP_PREDICTION_BLUE,
    "rgba(69, 163, 255, 0.92)",
    5.5,
    true
  );
}
