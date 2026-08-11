export const MEDIAPIPE_POSE_LANDMARK_NAMES = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer",
  "right_eye_inner", "right_eye", "right_eye_outer", "left_ear", "right_ear",
  "mouth_left", "mouth_right", "left_shoulder", "right_shoulder",
  "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_pinky",
  "right_pinky", "left_index", "right_index", "left_thumb", "right_thumb",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle",
  "right_ankle", "left_heel", "right_heel", "left_foot_index",
  "right_foot_index",
];

export const MEDIAPIPE_POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [17, 19], [19, 15], [15, 21],
  [16, 18], [18, 20], [20, 16], [16, 22],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

const VIRTUAL_CONNECTIONS = [
  ["shoulder_center", "torso_center"],
  ["torso_center", "hip_center"],
];

function validPoint(point) {
  return point && [point.x, point.y, point.z ?? 0].every(Number.isFinite);
}

function midpoint(first, second) {
  if (!validPoint(first) || !validPoint(second)) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: ((first.z || 0) + (second.z || 0)) / 2,
    visibility: Math.min(first.visibility ?? 1, second.visibility ?? 1),
  };
}

export function buildMediaPipePoseGraph(landmarks, { minVisibility = 0.2 } = {}) {
  const nodes = new Map();
  (landmarks || []).forEach((point, id) => {
    if (!validPoint(point) || (point.visibility ?? 1) < minVisibility) return;
    nodes.set(id, {
      id,
      name: MEDIAPIPE_POSE_LANDMARK_NAMES[id] || `landmark_${id}`,
      position: [point.x, point.y, point.z || 0],
      visibility: point.visibility ?? 1,
      source: point.source || "mediapipe",
      virtual: false,
    });
  });

  const virtualPoints = {
    shoulder_center: midpoint(landmarks?.[11], landmarks?.[12]),
    hip_center: midpoint(landmarks?.[23], landmarks?.[24]),
  };
  virtualPoints.torso_center = midpoint(
    virtualPoints.shoulder_center,
    virtualPoints.hip_center,
  );
  Object.entries(virtualPoints).forEach(([id, point]) => {
    if (!point) return;
    nodes.set(id, {
      id,
      name: id,
      position: [point.x, point.y, point.z],
      visibility: point.visibility,
      source: "derived",
      virtual: true,
    });
  });

  const edges = [...MEDIAPIPE_POSE_CONNECTIONS, ...VIRTUAL_CONNECTIONS]
    .filter(([from, to]) => nodes.has(from) && nodes.has(to))
    .map(([from, to]) => ({ from, to }));
  return { nodes, edges };
}

export function smoothPoseLandmarks(previous, current, alpha = 0.68) {
  if (!Array.isArray(current)) return [];
  return current.map((point, id) => {
    const prior = previous?.[id];
    if (!validPoint(point) || !validPoint(prior)) return point;
    return {
      ...point,
      x: prior.x + (point.x - prior.x) * alpha,
      y: prior.y + (point.y - prior.y) * alpha,
      z: (prior.z || 0) + ((point.z || 0) - (prior.z || 0)) * alpha,
    };
  });
}

export function normalizePoseWorldLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return [];
  const hipCenter = midpoint(landmarks[23], landmarks[24]);
  const shoulderCenter = midpoint(landmarks[11], landmarks[12]);
  if (!hipCenter || !shoulderCenter) return landmarks.map((point) => ({ ...point }));
  const torsoLength = Math.hypot(
    shoulderCenter.x - hipCenter.x,
    shoulderCenter.y - hipCenter.y,
    shoulderCenter.z - hipCenter.z,
  );
  const scale = torsoLength > 1e-5 ? 1 / torsoLength : 1;
  return landmarks.map((point) => validPoint(point) ? ({
    ...point,
    x: (point.x - hipCenter.x) * scale,
    y: (point.y - hipCenter.y) * scale,
    z: ((point.z || 0) - hipCenter.z) * scale,
  }) : point);
}

export function prepareMediaPipePoseFrame({
  cameraLandmarks,
  normalize = false,
  previousLandmarks,
  smoothing = 0.68,
  worldLandmarks,
}) {
  const source = worldLandmarks?.length ? worldLandmarks : cameraLandmarks || [];
  const smoothed = smoothPoseLandmarks(previousLandmarks, source, smoothing);
  const landmarks = normalize ? normalizePoseWorldLandmarks(smoothed) : smoothed;
  return {
    coordinateSpace: worldLandmarks?.length ? "world" : "camera",
    landmarks,
    graph: buildMediaPipePoseGraph(landmarks),
  };
}
