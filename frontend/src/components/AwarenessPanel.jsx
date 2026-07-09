const formatScore = (value) =>
  Number.isFinite(value) ? `${Math.round(value)}%` : "--";

const getScoreClass = (value, goodAt = 70) => {
  if (!Number.isFinite(value)) return "is-waiting";
  return value >= goodAt ? "is-good" : "is-low";
};

const getScoreWidth = (value) => {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
};

const FACE_CONTOURS = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152],
  [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  [33, 1, 263],
  [61, 13, 291],
  [61, 14, 291]
];
const FACE_FEATURES = {
  leftEye: [33, 160, 158, 133, 153, 144, 33],
  rightEye: [362, 385, 387, 263, 373, 380, 362],
  mouth: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  nose: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
};
const FACE_MESH_NEIGHBORS = 4;
const FACE_MESH_MAX_DISTANCE = 0.07;
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const POSE_FACE_CONNECTIONS = [
  [1, 2], [2, 3],
  [4, 5], [5, 6],
  [3, 0], [0, 6],
  [0, 9], [0, 10],
  [9, 10],
  [7, 1], [7, 9],
  [8, 4], [8, 10],
  [7, 0], [0, 8]
];

function normalizePoints(points = [], size = 120, padding = 14, mirrored = false) {
  const viewPoints = points.length ? points : [];
  const minX = viewPoints.length ? Math.min(...viewPoints.map((point) => point.x)) : 0.34;
  const maxX = viewPoints.length ? Math.max(...viewPoints.map((point) => point.x)) : 0.66;
  const minY = viewPoints.length ? Math.min(...viewPoints.map((point) => point.y)) : 0.2;
  const maxY = viewPoints.length ? Math.max(...viewPoints.map((point) => point.y)) : 0.72;
  const drawableSize = size - padding * 2;
  const scaleX = drawableSize / Math.max(maxX - minX, 0.001);
  const scaleY = drawableSize / Math.max(maxY - minY, 0.001);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;

  return {
    viewPoints,
    toSvgPoint: (point) => ({
      x: mirrored
        ? size - (offsetX + (point.x - minX) * scale)
        : offsetX + (point.x - minX) * scale,
      y: offsetY + (point.y - minY) * scale
    })
  };
}

function addFaceEdge(edges, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;

  const min = Math.min(fromIndex, toIndex);
  const max = Math.max(fromIndex, toIndex);
  edges.set(`${min}-${max}`, [min, max]);
}

function buildFaceMeshEdges(points = []) {
  const edges = new Map();

  FACE_CONTOURS.forEach((contour) => {
    contour.forEach((index, pointIndex) => {
      const nextIndex = contour[pointIndex + 1];
      if (Number.isInteger(nextIndex)) {
        addFaceEdge(edges, index, nextIndex);
      }
    });
  });

  points.forEach((point) => {
    const nearest = points
      .filter((candidate) => candidate.index !== point.index)
      .map((candidate) => {
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        return { candidate, distance };
      })
      .filter(({ distance }) => distance <= FACE_MESH_MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, FACE_MESH_NEIGHBORS);

    nearest.forEach(({ candidate }) => addFaceEdge(edges, point.index, candidate.index));
  });

  return Array.from(edges.values());
}

function buildFeaturePath(pointMap, toSvgPoint, feature) {
  return feature
    .map((index) => pointMap.get(index))
    .filter(Boolean)
    .map(toSvgPoint);
}

function FaceMeshPreview({ points = [], visible, mirrored = false, enabled = true }) {
  const pointMap = new Map(points.map((point) => [point.index, point]));
  const { viewPoints, toSvgPoint } = normalizePoints(points, 144, 8, mirrored);
  const isPoseFace = pointMap.has(0) && pointMap.has(10) && points.length <= 12;
  const meshEdges = isPoseFace ? POSE_FACE_CONNECTIONS : buildFaceMeshEdges(points);
  const features = {
    leftEye: buildFeaturePath(pointMap, toSvgPoint, FACE_FEATURES.leftEye),
    rightEye: buildFeaturePath(pointMap, toSvgPoint, FACE_FEATURES.rightEye),
    mouth: buildFeaturePath(pointMap, toSvgPoint, FACE_FEATURES.mouth),
    nose: buildFeaturePath(pointMap, toSvgPoint, FACE_FEATURES.nose)
  };

  return (
    <div className={`face-mesh-preview ${visible ? "is-live" : "is-empty"}`}>
      <svg aria-hidden="true" viewBox="0 0 144 144">
        <g className={isPoseFace ? "face-mesh-preview__pose" : "face-mesh-preview__mesh"}>
          {meshEdges.map(([fromIndex, toIndex]) => {
            const from = pointMap.get(fromIndex);
            const to = pointMap.get(toIndex);

            if (!from || !to) return null;

            const start = toSvgPoint(from);
            const end = toSvgPoint(to);

            return (
              <line
                key={`face-edge-${fromIndex}-${toIndex}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
              />
            );
          })}
        </g>
        {Object.entries(features).filter(([, path]) => path.length > 1).map(([name, path]) => (
          <polyline
            className={`face-mesh-preview__${name}`}
            key={`face-feature-${name}`}
            points={path.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
          />
        ))}
        {viewPoints.map((point) => {
          const svgPoint = toSvgPoint(point);

          return (
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              key={point.index}
              r={isPoseFace ? "2.8" : "1.6"}
            />
          );
        })}
      </svg>
      {!visible ? <span>{enabled ? "Waiting for face" : "Face off"}</span> : null}
    </div>
  );
}

function HandMeshPreview({ points = [], visible, mirrored = false }) {
  const pointMap = new Map(points.map((point) => [point.index, point]));
  const { viewPoints, toSvgPoint } = normalizePoints(points, 96, 12, mirrored);

  return (
    <div className={`hand-mesh-preview ${visible ? "is-live" : "is-empty"}`}>
      <svg aria-hidden="true" viewBox="0 0 96 96">
        {HAND_CONNECTIONS.map(([fromIndex, toIndex]) => {
          const from = pointMap.get(fromIndex);
          const to = pointMap.get(toIndex);

          if (!from || !to) return null;

          const start = toSvgPoint(from);
          const end = toSvgPoint(to);

          return (
            <line
              key={`hand-line-${fromIndex}-${toIndex}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
            />
          );
        })}
        {viewPoints.map((point) => {
          const svgPoint = toSvgPoint(point);

          return (
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              key={point.index}
              r="1.55"
            />
          );
        })}
      </svg>
      {!visible ? <span>No hand</span> : null}
    </div>
  );
}

function HandCard({ hand, label, points, mirrored }) {
  const visible = hand?.visible;
  const closure = hand?.fistScore;
  const openness = Number.isFinite(closure) ? 100 - closure : null;

  return (
    <article className={`awareness-hand ${visible ? "is-visible" : "is-missing"}`}>
      <div className="awareness-card__head">
        <span>{label}</span>
        <strong>{visible ? hand.state : "Not visible"}</strong>
      </div>
      <HandMeshPreview mirrored={mirrored} points={points} visible={visible} />
      <div className="awareness-bars">
        <div className="awareness-meter">
          <div>
            <span>Fist</span>
            <strong>{formatScore(closure)}</strong>
          </div>
          <i style={{ width: `${Number.isFinite(closure) ? closure : 0}%` }} />
        </div>
        <div className="awareness-meter awareness-meter--blue">
          <div>
            <span>Open</span>
            <strong>{formatScore(openness)}</strong>
          </div>
          <i style={{ width: `${Number.isFinite(openness) ? openness : 0}%` }} />
        </div>
      </div>
    </article>
  );
}

function FaceScoreTile({ label, value, displayValue, goodAt = 70 }) {
  return (
    <div className={getScoreClass(value, goodAt)}>
      <span>{label}</span>
      <strong>{displayValue ?? formatScore(value)}</strong>
      <i style={{ width: getScoreWidth(value) }} />
    </div>
  );
}

export default function AwarenessPanel({ awareness, mirrored = false }) {
  const face = awareness?.face || {};
  const faceEnabled = awareness?.faceEnabled !== false;
  const faceSource = awareness?.faceSource || face.source || "pose";
  const facePoints = awareness?.facePoints || [];
  const handPoints = awareness?.handPoints || {};
  const leftHand = awareness?.hands?.left;
  const rightHand = awareness?.hands?.right;

  return (
    <div className="awareness-panel">
      <div className="panel-heading">
        <p className="eyebrow">Awareness</p>
        <span>{awareness?.active ? "Live" : "Starting"}</span>
      </div>

      <article className="awareness-face">
        <FaceMeshPreview
          enabled={faceEnabled}
          mirrored={mirrored}
          points={facePoints}
          visible={face.visible}
        />
        <div className="awareness-face__main">
          <span>{faceSource === "mesh" ? "Face mesh" : "Pose face"}</span>
          <strong>{face.visible ? face.focus : faceEnabled ? "Move face into frame" : "Tracking off"}</strong>
        </div>
        <div className="awareness-face__grid">
          <FaceScoreTile label="Forward" value={face.forwardScore} />
          <FaceScoreTile label="Eyes" value={face.eyeScore} />
          <FaceScoreTile
            displayValue={face.visible ? face.expression : "--"}
            goodAt={55}
            label="Tension"
            value={face.calmScore}
          />
        </div>
      </article>

      <div className="awareness-hands">
        <HandCard
          hand={leftHand}
          label="Left hand"
          mirrored={mirrored}
          points={handPoints.left || []}
        />
        <HandCard
          hand={rightHand}
          label="Right hand"
          mirrored={mirrored}
          points={handPoints.right || []}
        />
      </div>
    </div>
  );
}
