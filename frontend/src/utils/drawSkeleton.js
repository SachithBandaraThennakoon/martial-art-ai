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
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const SKELETON_SCALE = 0.7;
const MIN_VISIBILITY = 0.35;

function fitLivePoint(point) {
  return {
    ...point,
    x: 0.5 + (point.x - 0.5) * SKELETON_SCALE,
    y: 0.5 + (point.y - 0.5) * SKELETON_SCALE
  };
}

function isVisible(point) {
  return point && (point.visibility == null || point.visibility >= MIN_VISIBILITY);
}

function shouldHighlight(connection, correctionParts) {
  return connection.parts.some((part) => correctionParts.has(part));
}

function getAnchoredHandPoints(hand, side, posePoints) {
  const points = hand.map(fitLivePoint);
  const poseWrist = posePoints?.[side === "left" ? 15 : 16];
  const handWrist = points[0];

  if (!isVisible(poseWrist) || !handWrist) {
    return points;
  }

  const offsetX = poseWrist.x - handWrist.x;
  const offsetY = poseWrist.y - handWrist.y;

  return points.map((point) => ({
    ...point,
    x: point.x + offsetX,
    y: point.y + offsetY
  }));
}

function drawHandSkeleton(ctx, handEntries, correctionParts, width, height, posePoints) {
  handEntries?.forEach(({ hand, side }) => {
    const points = getAnchoredHandPoints(hand, side, posePoints);
    const isCorrection =
      correctionParts.has(`fist_${side}`) ||
      correctionParts.has(`hand_${side}_open`);

    ctx.strokeStyle = isCorrection ? "#ff3b3b" : "rgba(255, 255, 255, 0.82)";
    ctx.fillStyle = isCorrection ? "#ff3b3b" : "rgba(255, 255, 255, 0.92)";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = isCorrection ? 3 : 2;
    ctx.shadowBlur = isCorrection ? 5 : 3;

    HAND_CONNECTIONS.forEach(([fromIndex, toIndex]) => {
      const from = points[fromIndex];
      const to = points[toIndex];

      if (!from || !to) return;

      ctx.beginPath();
      ctx.moveTo(from.x * width, from.y * height);
      ctx.lineTo(to.x * width, to.y * height);
      ctx.stroke();
    });

    points.forEach((point, index) => {
      const isTip = [4, 8, 12, 16, 20].includes(index);

      ctx.beginPath();
      ctx.arc(
        point.x * width,
        point.y * height,
        isCorrection && isTip ? 3 : 2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  });
}

export function drawSkeleton(
  canvas,
  poseLandmarks,
  correctionParts = new Set(),
  handEntries = []
) {
  if (!canvas || !poseLandmarks) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const width = canvas.width;
  const height = canvas.height;
  const points = poseLandmarks.map(fitLivePoint);

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

    ctx.strokeStyle = isCorrection ? "#ff3b3b" : "#ffffff";
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

    ctx.fillStyle = isCorrection ? "#ff3b3b" : "#ffffff";
    ctx.shadowColor = isCorrection
      ? "rgba(255, 59, 59, 0.55)"
      : "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, isCorrection ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });

  drawHandSkeleton(ctx, handEntries, correctionParts, width, height, points);
}
