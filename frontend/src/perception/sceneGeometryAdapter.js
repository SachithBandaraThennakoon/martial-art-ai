const FOOT_INDICES = [27, 28, 29, 30, 31, 32];
const HIP_INDICES = [23, 24];
const SHOULDER_INDICES = [11, 12];

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, Number(value) || 0));

const confidenceOf = (point) => clamp(point?.visibility ?? point?.presence ?? 1);
const usable = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const inCameraFrame = (point, margin = 0.015) =>
  usable(point) &&
  point.x >= margin &&
  point.x <= 1 - margin &&
  point.y >= margin &&
  point.y <= 1 - margin &&
  confidenceOf(point) >= 0.35;

function fullBodyInFrame(points) {
  const bilateralUpperBody = [...SHOULDER_INDICES, ...HIP_INDICES].every(
    (index) => inCameraFrame(points?.[index])
  );
  const leftFootVisible = [27, 29, 31].some((index) => inCameraFrame(points?.[index]));
  const rightFootVisible = [28, 30, 32].some((index) => inCameraFrame(points?.[index]));
  return bilateralUpperBody && leftFootVisible && rightFootVisible;
}

function center(points, indices) {
  const selected = indices.map((index) => points?.[index]).filter(usable);
  if (!selected.length) return null;
  return [
    selected.reduce((sum, point) => sum + point.x, 0) / selected.length,
    selected.reduce((sum, point) => sum + point.y, 0) / selected.length,
    selected.reduce((sum, point) => sum + (Number(point.z) || 0), 0) / selected.length,
  ];
}

function distance(first, second) {
  if (!usable(first) || !usable(second)) return null;
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    (Number(first.z) || 0) - (Number(second.z) || 0),
  );
}

function personBounds(points) {
  const selected = (points || []).filter((point) => usable(point) && confidenceOf(point) >= 0.35);
  if (!selected.length) return null;
  const xs = selected.map((point) => clamp(point.x));
  const ys = selected.map((point) => clamp(point.y));
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return [left, top, Math.max(0, right - left), Math.max(0, bottom - top)];
}

/**
 * Builds compact, privacy-safe scene and camera-relative geometry observations.
 * It converts MediaPipe's image/world landmarks into floor/wall polygons and a
 * ground plane. No RGB pixels, masks, or camera frames leave the browser.
 */
export function deriveSceneGeometry({ imagePose, worldPose, trackingConfidence = 0 }) {
  const imagePoints = Array.isArray(imagePose) ? imagePose : [];
  const worldPoints = Array.isArray(worldPose) ? worldPose : [];
  const visibleFeet = FOOT_INDICES.map((index) => imagePoints[index]).filter(inCameraFrame);
  const hasFullBodyFrame = fullBodyInFrame(imagePoints);
  const poseConfidence = clamp(trackingConfidence);
  const footConfidence = visibleFeet.length
    ? visibleFeet.reduce((sum, point) => sum + confidenceOf(point), 0) / visibleFeet.length
    : 0;
  const confidence = clamp(poseConfidence * 0.65 + footConfidence * 0.35);
  const fallbackBottom = personBounds(imagePoints)?.[1] + personBounds(imagePoints)?.[3];
  const footLine = visibleFeet.length
    ? visibleFeet.reduce((sum, point) => sum + clamp(point.y), 0) / visibleFeet.length
    : fallbackBottom;
  const floorY = clamp((Number.isFinite(footLine) ? footLine : 0.78) + 0.025, 0.45, 0.94);

  const worldFeet = FOOT_INDICES.map((index) => worldPoints[index]).filter(usable);
  const groundY = worldFeet.length
    ? worldFeet.reduce((sum, point) => sum + point.y, 0) / worldFeet.length
    : null;
  const userPosition = center(worldPoints, HIP_INDICES) || center(imagePoints, HIP_INDICES);
  const scaleEstimate = distance(worldPoints[SHOULDER_INDICES[0]], worldPoints[SHOULDER_INDICES[1]])
    || distance(imagePoints[SHOULDER_INDICES[0]], imagePoints[SHOULDER_INDICES[1]]);
  const groundPlane = groundY == null ? null : [0, 1, 0, -groundY];

  const floorBoundary = [[0, floorY], [1, floorY], [1, 1], [0, 1]];
  const wallBoundary = [[0, 0], [1, 0], [1, floorY], [0, floorY]];
  const floorConfidence = clamp(confidence);
  const wallConfidence = clamp(confidence * 0.82);

  return {
    human: {
      bbox: personBounds(imagePoints),
      position: userPosition,
    },
    surfaces: [
      {
        surface_id: "floor:primary",
        surface_type: "floor",
        confidence: floorConfidence,
        plane: groundPlane,
        boundary: floorBoundary,
        attributes: {
          method: "mediapipe-foot-ground-segmentation",
          estimated: true,
          image_area_ratio: clamp(1 - floorY),
        },
      },
      {
        surface_id: "wall:camera-field",
        surface_type: "wall",
        confidence: wallConfidence,
        boundary: wallBoundary,
        attributes: {
          method: "camera-field-background-segmentation",
          estimated: true,
          image_area_ratio: clamp(floorY),
        },
      },
    ],
    geometry: {
      source: "mediapipe-world-geometry",
      confidence,
      positions: userPosition ? { "user:primary": userPosition } : {},
      ground_plane: groundPlane,
      scale_estimate: scaleEstimate && scaleEstimate > 0 ? scaleEstimate : null,
      camera_pose: {
        coordinate_system: "mediapipe-world",
        origin: "hip-center",
        projection: "monocular-relative",
      },
      calibration: {
        mode: "landmark-relative",
        metric_depth: false,
        ground_anchor_count: worldFeet.length,
      },
    },
    diagnostics: {
      method: "pose-ground-v1",
      floor_line: floorY,
      visible_feet: visibleFeet.length,
      full_body_in_frame: hasFullBodyFrame,
      world_geometry: worldPoints.length >= 33,
      raw_media_stored: false,
    },
  };
}
