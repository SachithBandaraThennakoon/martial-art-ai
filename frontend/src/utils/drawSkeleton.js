const BODY_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28]
];

const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
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

export function drawSkeleton(canvas, poseLandmarks) {
  if (!canvas || !poseLandmarks) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const width = canvas.width;
  const height = canvas.height;
  const points = poseLandmarks.map(fitLivePoint);

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(255, 255, 255, 0.22)";
  ctx.shadowBlur = 4;

  BODY_CONNECTIONS.forEach(([fromIndex, toIndex]) => {
    const from = points[fromIndex];
    const to = points[toIndex];

    if (!isVisible(from) || !isVisible(to)) return;

    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();
  });

  ctx.shadowBlur = 2;
  KEY_JOINTS.forEach((index) => {
    const point = points[index];

    if (!isVisible(point)) return;

    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}
