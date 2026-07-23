import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import DataLayersPanel from "../components/DataLayersPanel";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";
import {
  createBrowserAudio,
  playBrowserAudio,
  prepareBrowserSpeech
} from "../services/browserVoice";
import {
  buildPracticeSetMessage,
  getPracticeFeedbackIntent
} from "../services/feedbackReasoning";

const COUNT_OPTIONS = [3, 5, 10];
const GAP_OPTIONS = [
  { label: "1.5s", value: 1500 },
  { label: "2s", value: 2000 },
  { label: "3s", value: 3000 }
];
const CLEAN_ACCURACY = 80;
const LOCAL_SESSION = { id: null, status: "active" };
const PRACTICE_VOICE_GENDER = "male";
const TAPE_CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
];
const TAPE_HIGHLIGHT_JOINTS = {
  shoulder_left: [11, 13],
  shoulder_right: [12, 14],
  elbow_left: [11, 13, 15],
  elbow_right: [12, 14, 16],
  wrist_left: [13, 15],
  wrist_right: [14, 16],
  fist_left: [13, 15, 17, 19, 21],
  fist_right: [14, 16, 18, 20, 22],
  hand_left_open: [13, 15, 17, 19, 21],
  hand_right_open: [14, 16, 18, 20, 22],
  hip_left: [11, 23, 25],
  hip_right: [12, 24, 26],
  knee_left: [23, 25, 27],
  knee_right: [24, 26, 28],
  eyes_forward: [0, 1, 2, 3, 4, 5, 6],
  face_forward: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  face_calm: [0, 1, 2, 3, 4, 5, 6, 9, 10]
};
const TAPE_VISIBLE_JOINTS = [
  0, 11, 12, 13, 14, 15, 16,
  23, 24, 25, 26, 27, 28
];
const TAPE_HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const TAPE_FACE_CONTOURS = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152],
  [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
];
const TAPE_POSE_FACE_CONNECTIONS = [
  [7, 3], [3, 2], [2, 1], [1, 0], [0, 4], [4, 5], [5, 6], [6, 8],
  [7, 9], [9, 10], [10, 8], [0, 9], [0, 10]
];
const TAPE_FACE_INDICES = new Set(TAPE_FACE_CONTOURS.flat());
const MOTION_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const formatTapeTime = (milliseconds = 0) => {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
};

const formatAttentionOffset = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "No response";
  if (Math.abs(milliseconds) < 50) return "On count";
  return `${milliseconds > 0 ? "+" : "−"}${Math.abs(milliseconds)} ms`;
};

const buildThirtyFpsTape = (sourceFrames, durationMs) => {
  if (!sourceFrames.length || durationMs <= 0) return [];

  const frameCount = Math.max(1, Math.round((durationMs / 1000) * 30));
  let sourceIndex = 0;

  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const elapsedMs = (frameIndex / 30) * 1000;
    while (
      sourceIndex + 1 < sourceFrames.length &&
      sourceFrames[sourceIndex + 1].elapsedMs <= elapsedMs
    ) {
      sourceIndex += 1;
    }
    return {
      ...sourceFrames[sourceIndex],
      elapsedMs,
      frame: frameIndex + 1
    };
  });
};

const quantizeCoordinate = (value) =>
  Number.isFinite(value) ? Math.round(value * 10000) : null;

const restoreCoordinate = (value) =>
  Number.isFinite(value) ? value / 10000 : null;

const encodePracticeTapeFrame = (frame) => ({
  t: Math.round(frame.elapsedMs || 0),
  n: frame.frame,
  r: frame.rep,
  s: frame.step,
  a: frame.accuracy,
  f: frame.focusBodyPart || null,
  i: frame.issue || null,
  w: frame.wrongBodyParts || [],
  p: (frame.landmarks || []).map((point) => [
    quantizeCoordinate(point?.x),
    quantizeCoordinate(point?.y)
  ]),
  face: (frame.facePoints || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  fs: frame.faceSource || "pose33",
  hl: (frame.handPoints?.left || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  hr: (frame.handPoints?.right || []).map((point) => [
    point.index,
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y)
  ]),
  ct: frame.countTimestampMs,
  ao: frame.attentionOffsetMs,
  at: frame.attentionTiming,
  mp: frame.movementPeakMs
});

const decodePracticeTapeFrame = (frame, index) => ({
  elapsedMs: frame.t || 0,
  frame: frame.n || index + 1,
  rep: frame.r || 1,
  step: frame.s || 1,
  accuracy: frame.a || 0,
  focusBodyPart: frame.f || null,
  issue: frame.i || null,
  wrongBodyParts: frame.w || [],
  landmarks: (frame.p || []).map(([x, y]) => ({
    x: restoreCoordinate(x),
    y: restoreCoordinate(y)
  })),
  facePoints: (frame.face || []).map(([pointIndex, x, y]) => ({
    index: pointIndex,
    x: restoreCoordinate(x),
    y: restoreCoordinate(y)
  })),
  faceSource: frame.fs || "pose33",
  handPoints: {
    left: (frame.hl || []).map(([pointIndex, x, y]) => ({
      index: pointIndex,
      x: restoreCoordinate(x),
      y: restoreCoordinate(y)
    })),
    right: (frame.hr || []).map(([pointIndex, x, y]) => ({
      index: pointIndex,
      x: restoreCoordinate(x),
      y: restoreCoordinate(y)
    }))
  },
  countTimestampMs: frame.ct ?? null,
  attentionOffsetMs: frame.ao ?? null,
  attentionTiming: frame.at || "no-response",
  movementPeakMs: frame.mp ?? null
});

const buildRepTapeFromFrames = (frames, steps) =>
  [...new Set(frames.map((frame) => frame.rep))].sort((a, b) => a - b).map((rep) => {
    const repFrames = frames.filter((frame) => frame.rep === rep);
    const weakestFrame = repFrames.reduce(
      (weakest, frame) =>
        !weakest || frame.accuracy < weakest.accuracy ? frame : weakest,
      null
    );
    const accuracy = repFrames.length
      ? Math.round(
          repFrames.reduce((total, frame) => total + (frame.accuracy || 0), 0) /
            repFrames.length
        )
      : 0;
    return {
      rep,
      elapsedMs: repFrames[0]?.countTimestampMs ?? repFrames[0]?.elapsedMs ?? 0,
      durationMs: Math.max(
        0,
        (repFrames[repFrames.length - 1]?.elapsedMs || 0) -
          (repFrames[0]?.elapsedMs || 0)
      ),
      accuracy,
      clean: accuracy >= CLEAN_ACCURACY,
      focusBodyPart: weakestFrame?.focusBodyPart || null,
      issue: weakestFrame?.issue || null,
      landmarks: weakestFrame?.landmarks || [],
      stepResults: steps.map((step, index) => {
        const stepFrames = repFrames.filter((frame) => frame.step === index + 1);
        const stepWeakest = stepFrames.reduce(
          (weakest, frame) =>
            !weakest || frame.accuracy < weakest.accuracy ? frame : weakest,
          null
        );
        return {
          step: index + 1,
          name: step?.step_name || `Step ${index + 1}`,
          accuracy: stepFrames.length
            ? Math.round(
                stepFrames.reduce(
                  (total, frame) => total + (frame.accuracy || 0),
                  0
                ) / stepFrames.length
              )
            : 0,
          captured: Boolean(stepFrames.length),
          focusBodyPart: stepWeakest?.focusBodyPart || null,
          issue: stepWeakest?.issue || "not_reached",
          landmarks: stepWeakest?.landmarks || []
        };
      })
    };
  });

const getPoseMotion = (previous = [], current = []) => {
  const distances = MOTION_JOINTS.map((index) => {
    const from = previous[index];
    const to = current[index];
    return from && to ? Math.hypot(to.x - from.x, to.y - from.y) : null;
  }).filter(Number.isFinite);
  return distances.length
    ? distances.reduce((total, distance) => total + distance, 0) / distances.length
    : 0;
};

const analyzeCountAttention = (frames, countMarkers, gapMs) => {
  const toleranceMs = Math.max(160, Math.round(gapMs * 0.14));
  const markers = countMarkers.map((marker, index) => {
    const windowStart = Math.max(0, marker.elapsedMs - gapMs * 0.25);
    const windowEnd = countMarkers[index + 1]?.elapsedMs ?? marker.elapsedMs + gapMs;
    const candidates = frames.filter(
      (frame) => frame.elapsedMs >= windowStart && frame.elapsedMs <= windowEnd
    );
    const peak = candidates.reduce(
      (best, frame) => !best || frame.motionScore > best.motionScore ? frame : best,
      null
    );
    const offsetMs = peak ? Math.round(peak.elapsedMs - marker.elapsedMs) : null;
    const timing = !Number.isFinite(offsetMs)
      ? "no-response"
      : offsetMs < -toleranceMs
        ? "early"
        : offsetMs > toleranceMs
          ? "late"
          : "on-time";
    return { ...marker, rep: index + 1, movementPeakMs: peak?.elapsedMs ?? null, offsetMs, timing };
  });

  return frames.map((frame) => {
    const marker = [...markers]
      .reverse()
      .find((candidate) => candidate.elapsedMs <= frame.elapsedMs) || markers[0];
    return {
      ...frame,
      rep: marker?.rep || frame.rep,
      countTimestampMs: marker?.elapsedMs ?? null,
      attentionOffsetMs: marker?.offsetMs ?? null,
      attentionTiming: marker?.timing || "no-response",
      movementPeakMs: marker?.movementPeakMs ?? null
    };
  });
};

function TapeSkeleton({
  facePoints = [],
  handPoints = {},
  highlightBodyPart,
  highlightBodyParts = [],
  landmarks,
  mirrored = true,
  overlay = false
}) {
  const points = Array.isArray(landmarks) ? landmarks : [];
  const highlightedJoints = new Set(
    [highlightBodyPart, ...highlightBodyParts]
      .filter(Boolean)
      .flatMap((bodyPart) => TAPE_HIGHLIGHT_JOINTS[bodyPart] || [])
  );
  const pointAt = (index) => {
    const point = points[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * (overlay ? 75 : 100)
    };
  };
  const detailPoint = (point) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x: (mirrored ? 1 - point.x : point.x) * 100,
      y: point.y * (overlay ? 75 : 100)
    };
  };
  const faceMap = new Map(facePoints.map((point) => [point.index, point]));
  const isPoseFace = facePoints.length > 0 && facePoints.length <= 12;
  const faceConnections = isPoseFace
    ? TAPE_POSE_FACE_CONNECTIONS
    : TAPE_FACE_CONTOURS.flatMap((contour) =>
        contour.slice(1).map((to, index) => [contour[index], to])
      );
  const isFaceWrong = ["eyes_forward", "face_forward", "face_calm"]
    .some((part) => highlightBodyPart === part || highlightBodyParts.includes(part));

  return (
    <svg
      aria-hidden="true"
      className={`practice-tape-skeleton ${overlay ? "practice-tape-skeleton--overlay" : ""}`}
      viewBox={overlay ? "0 0 100 75" : "0 0 100 100"}
    >
      {faceConnections.map(([from, to]) => {
        const start = detailPoint(faceMap.get(from));
        const end = detailPoint(faceMap.get(to));
        return start && end ? (
          <line
            className={`is-detail ${isFaceWrong ? "is-wrong" : ""}`}
            key={`face-${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        ) : null;
      })}
      {Object.entries(handPoints).flatMap(([side, hand]) => {
        const handMap = new Map((hand || []).map((point) => [point.index, point]));
        const poseHand = handMap.size > 0 && handMap.size <= 4;
        const connections = poseHand ? [[0, 4], [0, 8], [0, 20]] : TAPE_HAND_CONNECTIONS;
        const handWrong = [`fist_${side}`, `hand_${side}_open`, `wrist_${side}`]
          .some((part) => highlightBodyPart === part || highlightBodyParts.includes(part));
        return connections.map(([from, to]) => {
          const start = detailPoint(handMap.get(from));
          const end = detailPoint(handMap.get(to));
          return start && end ? (
            <line
              className={`is-detail ${handWrong ? "is-wrong" : ""}`}
              key={`hand-${side}-${from}-${to}`}
              x1={start.x}
              x2={end.x}
              y1={start.y}
              y2={end.y}
            />
          ) : null;
        });
      })}
      {TAPE_CONNECTIONS.map(([from, to]) => {
        const start = pointAt(from);
        const end = pointAt(to);
        return start && end ? (
          <line
            className={highlightedJoints.has(from) || highlightedJoints.has(to) ? "is-wrong" : ""}
            key={`${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        ) : null;
      })}
      {TAPE_VISIBLE_JOINTS.map((index) => {
        const point = pointAt(index);
        return point ? (
          <circle
            className={highlightedJoints.has(index) ? "is-wrong" : ""}
            cx={point.x}
            cy={point.y}
            key={index}
            r={index === 0 ? 3 : 1.8}
          />
        ) : null;
      })}
      {facePoints
        .filter((point) => isPoseFace || TAPE_FACE_INDICES.has(point.index))
        .map((point) => {
          const position = detailPoint(point);
          return position ? (
            <circle
              className={`is-detail ${isFaceWrong ? "is-wrong" : ""}`}
              cx={position.x}
              cy={position.y}
              key={`face-point-${point.index}`}
              r={isPoseFace ? 1.1 : 0.55}
            />
          ) : null;
        })}
      {Object.entries(handPoints).flatMap(([side, hand]) =>
        (hand || []).map((point) => {
          const position = detailPoint(point);
          return position ? (
            <circle
              className="is-detail"
              cx={position.x}
              cy={position.y}
              key={`hand-point-${side}-${point.index}`}
              r="0.75"
            />
          ) : null;
        })
      )}
      {!points.length ? (
        <text x="50" y="52" textAnchor="middle">POSE</text>
      ) : null}
    </svg>
  );
}

function LandmarkDetailSkeleton({ kind, points = [], mirrored = true }) {
  if (!points.length) {
    return (
      <svg aria-hidden="true" className="practice-landmark-detail" viewBox="0 0 100 64">
        <text x="50" y="35" textAnchor="middle">WAITING</text>
      </svg>
    );
  }

  const pointMap = new Map(points.map((point) => [point.index, point]));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);
  const scale = Math.min(84 / width, 52 / height);
  const offsetX = (100 - width * scale) / 2;
  const offsetY = (64 - height * scale) / 2;
  const toPoint = (point) => ({
    x: mirrored
      ? 100 - (offsetX + (point.x - minX) * scale)
      : offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale
  });
  const isPoseDetail = points.length <= (kind === "face" ? 12 : 4);
  const connections = kind === "face"
    ? isPoseDetail
      ? TAPE_POSE_FACE_CONNECTIONS
      : TAPE_FACE_CONTOURS.flatMap((contour) =>
          contour.slice(1).map((to, index) => [contour[index], to])
        )
    : isPoseDetail
      ? [[0, 4], [0, 8], [0, 20]]
      : TAPE_HAND_CONNECTIONS;

  return (
    <svg aria-hidden="true" className="practice-landmark-detail" viewBox="0 0 100 64">
      {connections.map(([from, to]) => {
        const fromPoint = pointMap.get(from);
        const toLandmark = pointMap.get(to);
        if (!fromPoint || !toLandmark) return null;
        const start = toPoint(fromPoint);
        const end = toPoint(toLandmark);
        return (
          <line
            key={`${kind}-${from}-${to}`}
            x1={start.x}
            x2={end.x}
            y1={start.y}
            y2={end.y}
          />
        );
      })}
      {points.map((point) => {
        const position = toPoint(point);
        return (
          <circle
            cx={position.x}
            cy={position.y}
            key={`${kind}-point-${point.index}`}
            r={kind === "face" && !isPoseDetail ? .8 : 1.35}
          />
        );
      })}
    </svg>
  );
}

function PracticeAccuracyTimeline({
  countFilter = "all",
  contentWidth = 470,
  expanded = false,
  frames = [],
  onScroll,
  onSelectFrame,
  scrollRef,
  selectedFrame,
  stepFilter = "all"
}) {
  const plot = { left: 0, top: 8, width: contentWidth, height: expanded ? 82 : 44 };
  const chartHeight = expanded ? 112 : 72;
  const duration = Math.max(frames[frames.length - 1]?.elapsedMs || 0, 1);
  const stride = Math.max(1, Math.ceil(frames.length / (expanded ? 180 : 100)));
  const sampled = frames.filter(
    (_, index) => index % stride === 0 || index === frames.length - 1
  );
  const xAt = (elapsedMs) => plot.left + (elapsedMs / duration) * plot.width;
  const yAt = (accuracy) =>
    plot.top + plot.height - (Math.max(0, Math.min(100, accuracy || 0)) / 100) * plot.height;
  const linePoints = sampled
    .map((frame) => `${xAt(frame.elapsedMs).toFixed(1)},${yAt(frame.accuracy).toFixed(1)}`)
    .join(" ");
  const frameMatchesFilter = (frame) =>
    (countFilter === "all" || frame.rep === Number(countFilter)) &&
    (stepFilter === "all" || frame.step === Number(stepFilter));
  const activeSegments = frames.reduce((segments, frame) => {
    if (!frameMatchesFilter(frame)) return segments;
    const previousSegment = segments[segments.length - 1];
    const previousFrame = previousSegment?.[previousSegment.length - 1];
    if (!previousFrame || frame.frame !== previousFrame.frame + 1) {
      segments.push([frame]);
    } else {
      previousSegment.push(frame);
    }
    return segments;
  }, []);
  const countMarkers = Array.from(
    frames.reduce((markers, frame) => {
      if (!markers.has(frame.rep)) {
        markers.set(frame.rep, frame.countTimestampMs ?? frame.elapsedMs);
      }
      return markers;
    }, new Map()).entries()
  );
  const dropPoints = frames
    .filter(frameMatchesFilter)
    .filter((frame) => {
      const previous = frames[frame.frame - 2];
      const next = frames[frame.frame];
      return frame.accuracy < CLEAN_ACCURACY &&
        (!previous || frame.accuracy <= previous.accuracy) &&
        (!next || frame.accuracy <= next.accuracy);
    })
    .filter((_, index, points) => {
      const previous = points[index - 1];
      return !previous || _.elapsedMs - previous.elapsedMs >= 250;
    })
    .sort((left, right) => left.accuracy - right.accuracy)
    .slice(0, expanded ? 12 : 6)
    .sort((left, right) => left.elapsedMs - right.elapsedMs);

  return (
    <div className={`practice-accuracy-timeline ${expanded ? "is-expanded" : ""}`}>
      <div className="practice-accuracy-timeline__heading">
        <div>
          <span>Session accuracy</span>
          <strong>One line · X time · Y accuracy</strong>
        </div>
        <span><i /> Accuracy drop</span>
      </div>
      <div
        className="practice-accuracy-timeline__scroller"
        onScroll={onScroll}
        ref={scrollRef}
      >
        <svg
          aria-label="Session accuracy over time with selectable accuracy drops"
          className="practice-accuracy-timeline__plot"
          role="img"
          style={{ height: `${chartHeight}px`, width: `${contentWidth}px` }}
          viewBox={`0 0 ${contentWidth} ${chartHeight}`}
        >
          <line
            className="is-target"
            x1={plot.left}
            x2={plot.left + plot.width}
            y1={yAt(CLEAN_ACCURACY)}
            y2={yAt(CLEAN_ACCURACY)}
          />
          {countMarkers.map(([rep, elapsedMs]) => (
            <g key={`timeline-count-${rep}`}>
              <line
                className="is-count-marker"
                x1={xAt(elapsedMs)}
                x2={xAt(elapsedMs)}
                y1={plot.top}
                y2={plot.top + plot.height}
              />
              <text className="is-count-label" x={xAt(elapsedMs) + 3} y={plot.top + 8}>
                C{rep}
              </text>
            </g>
          ))}
          <text x="3" y={yAt(CLEAN_ACCURACY) - 3}>80%</text>
          <text x="3" y={chartHeight - 2}>0:00</text>
          <text x={contentWidth - 3} y={chartHeight - 2} textAnchor="end">
            {formatTapeTime(duration)}
          </text>
          <polyline className="is-context" points={linePoints} />
          {activeSegments.map((segment, segmentIndex) => {
            const segmentStride = Math.max(
              1,
              Math.ceil(segment.length / (expanded ? 180 : 100))
            );
            const points = segment
              .filter(
                (_, index) =>
                  index % segmentStride === 0 || index === segment.length - 1
              )
              .map(
                (frame) =>
                  `${xAt(frame.elapsedMs).toFixed(1)},${yAt(frame.accuracy).toFixed(1)}`
              )
              .join(" ");
            return (
              <polyline
                className="is-active"
                key={`active-accuracy-${segmentIndex}`}
                points={points}
              />
            );
          })}
          {dropPoints.map((frame) => (
            <circle
              aria-label={`Accuracy drop at ${formatTapeTime(frame.elapsedMs)}, count ${frame.rep}, step ${frame.step}, ${frame.accuracy}%`}
              className={frame.frame - 1 === selectedFrame ? "is-selected" : ""}
              cx={xAt(frame.elapsedMs)}
              cy={yAt(frame.accuracy)}
              key={`accuracy-drop-${frame.frame}`}
              onClick={() => onSelectFrame?.(frame.frame - 1)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectFrame?.(frame.frame - 1);
                }
              }}
              r={frame.frame - 1 === selectedFrame ? 4.5 : 3.2}
              role="button"
              tabIndex={0}
            >
              <title>
                {`Count ${frame.rep} · Step ${frame.step} · ${frame.accuracy}% · ${formatTapeTime(frame.elapsedMs)}`}
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Whole form";

const formatSessionTimestamp = (value) => {
  if (!value) return "No completed set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

function scorePracticeAngles(requiredParts, liveAngles) {
  if (!requiredParts.length) {
    return {
      accuracy: 0,
      focusBodyPart: null,
      issue: "needs_targets",
      wrongBodyParts: []
    };
  }

  let score = 0;
  let worst = null;
  const wrongBodyParts = [];

  requiredParts.forEach((part) => {
    const value = liveAngles?.[part.body_part];

    if (!Number.isFinite(value)) {
      worst = worst || { bodyPart: part.body_part, issue: "missing", severity: 100 };
      wrongBodyParts.push(part.body_part);
      return;
    }

    let diff = 0;
    let issue = "good";
    if (value < part.min) {
      diff = part.min - value;
      issue = "too_closed";
    } else if (value > part.max) {
      diff = value - part.max;
      issue = "too_open";
    }

    const partScore = Math.max(0, 100 - diff * 2);
    score += partScore;
    if (issue !== "good") wrongBodyParts.push(part.body_part);
    if (!worst || diff > worst.severity) {
      worst = { bodyPart: part.body_part, issue, severity: diff };
    }
  });

  return {
    accuracy: Math.round(score / requiredParts.length),
    focusBodyPart: worst?.bodyPart || null,
    issue: worst?.issue || "good",
    wrongBodyParts
  };
}

function speedLabel(durationMs) {
  if (durationMs <= 900) return "fast";
  if (durationMs >= 2400) return "slow";
  return "steady";
}

function parseCountCommand(message) {
  const normalized = message.toLowerCase();
  const numericCount = normalized.match(/\b(\d{1,2})\b/);
  if (numericCount) {
    const count = Number(numericCount[1]);
    if (count >= 1 && count <= 50) return count;
  }
  if (/\bthree\b/.test(normalized)) return 3;
  if (/\bfive\b/.test(normalized)) return 5;
  if (/\bten\b/.test(normalized)) return 10;
  return null;
}

function classifyPracticeCommand(message) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  const requestedCount = parseCountCommand(normalized);

  if (requestedCount && /\b(count|reps?|repetitions?)\b/.test(normalized)) {
    return { intent: "set_count", count: requestedCount };
  }
  if (/\b(not ready|wait|pause|hold on|not now)\b/.test(normalized)) {
    return { intent: "wait" };
  }
  if (/\b(reset|stop|cancel)\b/.test(normalized)) {
    return { intent: "reset" };
  }
  if (/\b(analysis|results?|review)\b/.test(normalized)) {
    return { intent: "analysis" };
  }
  if (/\b(train|training mode|guided training)\b/.test(normalized)) {
    return { intent: "train" };
  }
  if (/\b(previous|back|prior step)\b/.test(normalized)) {
    return { intent: "previous" };
  }
  if (/\b(next|next step|move on)\b/.test(normalized)) {
    return { intent: "next" };
  }
  if (/\b(start|begin|go|ready|yes|practice again|again)\b/.test(normalized)) {
    return { intent: "start" };
  }

  return { intent: "unknown" };
}

export default function PracticeMode({
  categorySlug,
  displayMirrored = true,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug,
  textEnabled = true,
  voiceEnabled = true,
  isAdminStudio = false,
  performanceProfile = "student",
  performanceMode = "auto",
  skeletonLayers = {},
  bodyCalibration
}) {
  const currentTechnique = useMemo(
    () =>
      getTechniqueFromCatalog({
        categorySlug,
        subcategorySlug,
        techniqueName: selectedTechniqueName
      }),
    [categorySlug, selectedTechniqueName, subcategorySlug]
  );
  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const selectedStep = steps[selectedStepIndex] || steps[0];
  const requiredParts = useMemo(() => selectedStep?.angles || [], [selectedStep]);
  const [targetReps, setTargetReps] = useState(5);
  const [countGapMs, setCountGapMs] = useState(2000);
  const [session, setSession] = useState(null);
  const [repCount, setRepCount] = useState(0);
  const [cleanReps, setCleanReps] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [focusBodyPart, setFocusBodyPart] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState(
    "Choose a count and start practice."
  );
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [showDataLayers, setShowDataLayers] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [conversation, setConversation] = useState([
    { role: "ai", text: "Choose a count and say start when ready." }
  ]);
  const [practiceInput, setPracticeInput] = useState("");
  const [voiceInputStatus, setVoiceInputStatus] = useState("Say start to begin.");
  const [isListening, setIsListening] = useState(false);
  const [isReadyForRep, setIsReadyForRep] = useState(true);
  const [practiceAnalysis, setPracticeAnalysis] = useState(null);
  const [repTape, setRepTape] = useState([]);
  const [tapeCursor, setTapeCursor] = useState(0);
  const [tapeStepCursor, setTapeStepCursor] = useState(0);
  const [isTapePlaying, setIsTapePlaying] = useState(false);
  const [fullTapeFrames, setFullTapeFrames] = useState([]);
  const [analysisTapeMetadata, setAnalysisTapeMetadata] = useState(null);
  const [fullTapeCursor, setFullTapeCursor] = useState(0);
  const [isFullTapePlaying, setIsFullTapePlaying] = useState(false);
  const [isTapePopupOpen, setIsTapePopupOpen] = useState(false);
  const [isTapePopupExpanded, setIsTapePopupExpanded] = useState(true);
  const [isCameraRollExpanded, setIsCameraRollExpanded] = useState(false);
  const [cameraRollZoom, setCameraRollZoom] = useState(3);
  const [analysisCountFilter, setAnalysisCountFilter] = useState("all");
  const [analysisStepFilter, setAnalysisStepFilter] = useState("all");
  const [historySessionPopup, setHistorySessionPopup] = useState(null);
  const [sessionSortDirection, setSessionSortDirection] = useState("desc");
  const [recoveryRemainingMs, setRecoveryRemainingMs] = useState(0);
  const isPracticeActive = session?.status === "active";
  const practiceSkeletonLayers = useMemo(
    () => ({ ...skeletonLayers, live: false, expected: false }),
    [skeletonLayers]
  );
  const practiceNeedsReply = !isPracticeActive;
  const practiceReplyOptions = session?.status === "completed"
    ? [
        { label: "Practice again", value: "start" },
        { label: "View analysis", value: "analysis" },
        { label: "Training mode", value: "train" }
      ]
    : [
        { label: "Start set", value: "start" },
        { label: "3 reps", value: "count 3" },
        { label: "5 reps", value: "count 5" },
        { label: "10 reps", value: "count 10" }
      ];
  const repStartedAtRef = useRef(null);
  const setStartedAtRef = useRef(null);
  const latestLandmarksRef = useRef([]);
  const latestHolisticFrameRef = useRef({
    facePoints: [],
    handPoints: {},
    motionEnergy: 0
  });
  const previousRecordedLandmarksRef = useRef([]);
  const countMarkersRef = useRef([]);
  const selectedStepIndexRef = useRef(0);
  const recordedFramesRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const cameraRollScrollRef = useRef(null);
  const accuracyTimelineScrollRef = useRef(null);
  const timelineScrollSyncRef = useRef(false);
  const recoveryEndsAtRef = useRef(null);
  const sessionRef = useRef(null);
  const repCountRef = useRef(0);
  const isReadyForRepRef = useRef(true);
  const countBeatRef = useRef(null);
  const countBeatTimersRef = useRef([]);
  const stepScanTimersRef = useRef([]);
  const latestPracticeResultRef = useRef({
    accuracy: 0,
    focusBodyPart: null,
    issue: "waiting",
    wrongBodyParts: []
  });
  const cycleStepResultsRef = useRef([]);
  const numberAudioRef = useRef([]);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(true);
  const restartListenTimerRef = useRef(null);
  const startVoiceInputRef = useRef(null);
  const currentAudioRef = useRef(null);
  const voiceQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const voiceRequestIdRef = useRef(0);
  const voiceCacheRef = useRef(new Map());
  const greetedTechniqueRef = useRef("");
  const attentionReminderTimerRef = useRef(null);
  const lastPracticeFeedbackIntentRef = useRef("");
  const lastPracticeSpokenIntentRef = useRef("");

  const selectedTapeRep = repTape[tapeCursor] || repTape[repTape.length - 1] || null;
  const selectedTapeStep = selectedTapeRep?.stepResults?.[tapeStepCursor] || null;
  const tapeDurationMs = repTape[repTape.length - 1]?.elapsedMs || 0;
  const fullTapeFrame = fullTapeFrames[fullTapeCursor] || null;
  const tapeAnalysisSteps = analysisTapeMetadata?.steps?.length
    ? analysisTapeMetadata.steps
    : steps;
  const tapeTargetReps = analysisTapeMetadata?.targetReps || targetReps;
  const popupRepTape = analysisTapeMetadata?.repTape || repTape;
  const timelineContentWidth = Math.max(
    900,
    fullTapeFrames.length * cameraRollZoom
  );
  const timelineFrameWidth = fullTapeFrames.length
    ? timelineContentWidth / fullTapeFrames.length
    : cameraRollZoom;
  const filteredTapeFrames = fullTapeFrames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) =>
      (analysisCountFilter === "all" || frame.rep === Number(analysisCountFilter)) &&
      (analysisStepFilter === "all" || frame.step === Number(analysisStepFilter))
    );
  const filteredTapeCursorPosition = Math.max(
    0,
    filteredTapeFrames.findIndex((entry) => entry.index === fullTapeCursor)
  );
  const fullTapeDurationMs = fullTapeFrames.length
    ? (fullTapeFrames.length / 30) * 1000
    : 0;
  const fullTapeAverageAccuracy = fullTapeFrames.length
    ? Math.round(
        fullTapeFrames.reduce((total, frame) => total + (frame.accuracy || 0), 0) /
          fullTapeFrames.length
      )
    : 0;
  const fullTapeReviewFrames = fullTapeFrames.filter(
    (frame) => frame.accuracy < CLEAN_ACCURACY
  ).length;
  const fullTapeIssueCounts = fullTapeFrames.reduce((counts, frame) => {
    (frame.wrongBodyParts || []).forEach((bodyPart) => {
      counts[bodyPart] = (counts[bodyPart] || 0) + 1;
    });
    return counts;
  }, {});
  const fullTapePrimaryIssue = Object.entries(fullTapeIssueCounts).sort(
    (left, right) => right[1] - left[1]
  )[0]?.[0] || null;
  const countAttentionResults = Array.from(
    fullTapeFrames.reduce((results, frame) => {
      if (!results.has(frame.rep)) {
        results.set(frame.rep, {
          rep: frame.rep,
          offsetMs: frame.attentionOffsetMs,
          timing: frame.attentionTiming,
          timestampMs: frame.countTimestampMs
        });
      }
      return results;
    }, new Map()).values()
  );
  const onTimeCount = countAttentionResults.filter(
    (result) => result.timing === "on-time"
  ).length;
  const attentionRate = countAttentionResults.length
    ? Math.round((onTimeCount / countAttentionResults.length) * 100)
    : 0;
  const sequenceStepStats = tapeAnalysisSteps.map((step, index) => {
    const results = popupRepTape
      .map((rep) => rep.stepResults?.[index])
      .filter(Boolean);
    return {
      step: index + 1,
      name: step?.step_name || `Step ${index + 1}`,
      accuracy: results.length
        ? Math.round(results.reduce((total, result) => total + result.accuracy, 0) / results.length)
        : 0,
      coverage: popupRepTape.length
        ? Math.round((results.filter((result) => result.captured).length / popupRepTape.length) * 100)
        : 0
    };
  });
  const weakestSequenceStep = [...sequenceStepStats].sort(
    (left, right) => left.accuracy - right.accuracy
  )[0] || null;
  const repAccuracyValues = popupRepTape.map((rep) => rep.accuracy);
  const repAccuracyMean = repAccuracyValues.length
    ? repAccuracyValues.reduce((total, value) => total + value, 0) / repAccuracyValues.length
    : 0;
  const sequenceConsistency = repAccuracyValues.length
    ? Math.max(
        0,
        Math.round(
          100 -
            Math.sqrt(
              repAccuracyValues.reduce(
                (total, value) => total + (value - repAccuracyMean) ** 2,
                0
              ) / repAccuracyValues.length
            )
        )
      )
    : 0;
  const fullTapeRecommendation = attentionRate < 70 && countAttentionResults.length
    ? "React to the count without rushing. Begin the sequence on the cue, then complete every step at your natural speed."
    : fullTapeAverageAccuracy >= CLEAN_ACCURACY
      ? "Keep this rhythm. Repeat the same count gap and aim for the same clean shape."
    : fullTapePrimaryIssue && weakestSequenceStep
      ? `Rehearse step ${weakestSequenceStep.step}, ${weakestSequenceStep.name}, with focus on ${formatBodyPart(fullTapePrimaryIssue)}. Add 0.5 seconds to the next count gap.`
      : "Repeat once with your full body visible so every angle can be measured.";

  selectedStepIndexRef.current = selectedStepIndex;

  const syncTimelineScroll = useCallback((source, targetRef) => {
    if (timelineScrollSyncRef.current || !targetRef.current) return;
    timelineScrollSyncRef.current = true;
    const sourceRange = Math.max(1, source.scrollWidth - source.clientWidth);
    const targetRange = Math.max(
      0,
      targetRef.current.scrollWidth - targetRef.current.clientWidth
    );
    targetRef.current.scrollLeft = (source.scrollLeft / sourceRange) * targetRange;
    window.requestAnimationFrame(() => {
      timelineScrollSyncRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!isTapePlaying || !repTape.length) return undefined;

    const timerId = window.setTimeout(() => {
      setTapeStepCursor(0);
      setTapeCursor((current) => {
        if (current >= repTape.length - 1) {
          setIsTapePlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Math.max(650, Math.min(repTape[tapeCursor + 1]?.durationMs || 1000, 1800)));

    return () => window.clearTimeout(timerId);
  }, [isTapePlaying, repTape, tapeCursor]);

  useEffect(() => {
    if (!isFullTapePlaying || !fullTapeFrames.length) return undefined;

    const timerId = window.setInterval(() => {
      setFullTapeCursor((current) => {
        for (let next = current + 1; next < fullTapeFrames.length; next += 1) {
          const frame = fullTapeFrames[next];
          const matchesCount =
            analysisCountFilter === "all" || frame.rep === Number(analysisCountFilter);
          const matchesStep =
            analysisStepFilter === "all" || frame.step === Number(analysisStepFilter);
          if (matchesCount && matchesStep) return next;
        }
        setIsFullTapePlaying(false);
        return current;
      });
    }, 1000 / 30);

    return () => window.clearInterval(timerId);
  }, [
    analysisCountFilter,
    analysisStepFilter,
    fullTapeFrames,
    isFullTapePlaying
  ]);

  useEffect(() => {
    if (!isPracticeActive || !recoveryEndsAtRef.current) {
      setRecoveryRemainingMs(0);
      return undefined;
    }

    const updateRecovery = () => {
      const remaining = Math.max(0, recoveryEndsAtRef.current - performance.now());
      setRecoveryRemainingMs(remaining);
      if (!remaining) recoveryEndsAtRef.current = null;
    };
    updateRecovery();
    const timerId = window.setInterval(updateRecovery, 100);
    return () => window.clearInterval(timerId);
  }, [isPracticeActive, repCount]);

  const appendConversation = useCallback((item) => {
    if (!textEnabled) return;
    setConversation((items) => [...items.slice(-7), item]);
  }, [textEnabled]);

  const handleLevel1Update = useCallback((nextState) => {
    setLevel1State(nextState);
    if (nextState?.debug?.currentLandmarks?.length) {
      latestLandmarksRef.current = nextState.debug.currentLandmarks;
    }
  }, []);

  const handleLandmarkFrame = useCallback((frame) => {
    latestLandmarksRef.current = frame?.pose || [];
    latestHolisticFrameRef.current = frame || {
      facePoints: [],
      handPoints: {},
      motionEnergy: 0
    };
  }, []);

  const loadPracticeAnalysis = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/practice/analysis`, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });
      if (response.ok) {
        setPracticeAnalysis(await response.json());
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        // Practice remains usable when historical analysis is temporarily offline.
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPracticeAnalysis(controller.signal);
    return () => controller.abort();
  }, [loadPracticeAnalysis]);

  const fetchPracticeVoice = useCallback(async (message) => {
    const trimmed = message.trim();
    if (!voiceEnabled || !trimmed) return null;

    const cacheKey = `${PRACTICE_VOICE_GENDER}:${trimmed}`;
    const cached = voiceCacheRef.current.get(cacheKey);
    if (cached) return cached;

    try {
      const data = prepareBrowserSpeech(trimmed, {
        gender: PRACTICE_VOICE_GENDER,
        rate: 0.9,
        pitch: 0.76
      });
      voiceCacheRef.current.set(cacheKey, data);
      return data;
    } catch {
      return null;
    }
  }, [voiceEnabled]);

  const playPracticeAudio = useCallback(async (message, data, requestId) => {
    if (!data || requestId !== voiceRequestIdRef.current) return;

    const playback = createBrowserAudio(data);
    if (!playback) return;

    const { audio, release } = playback;
    currentAudioRef.current = audio;

    await new Promise((resolve) => {
      const finish = () => {
        release();
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      playBrowserAudio(audio).catch(finish);
    });
  }, []);

  const playVoiceQueue = useCallback(async () => {
    if (isSpeakingRef.current || !voiceEnabled) return;

    const nextMessage = voiceQueueRef.current.shift();
    if (!nextMessage) return;

    const requestId = voiceRequestIdRef.current;
    isSpeakingRef.current = true;

    try {
      const data = await fetchPracticeVoice(nextMessage);
      await playPracticeAudio(nextMessage, data, requestId);
    } catch {
      // Voice is helpful in practice, but counting should continue without it.
    } finally {
      if (requestId === voiceRequestIdRef.current) {
        isSpeakingRef.current = false;
        if (voiceQueueRef.current.length) {
          playVoiceQueue();
        }
      }
    }
  }, [fetchPracticeVoice, playPracticeAudio, voiceEnabled]);

  const queuePracticeVoice = useCallback((message, { force = false, intent } = {}) => {
    const trimmed = message.trim();
    if (!voiceEnabled || !trimmed) return;

    const feedbackIntent = intent || getPracticeFeedbackIntent(trimmed);
    if (!force && feedbackIntent === lastPracticeSpokenIntentRef.current) return;

    lastPracticeSpokenIntentRef.current = feedbackIntent;
    // Keep the active sentence and replace any stale pending guidance with the
    // newest semantic instruction.
    voiceQueueRef.current = [trimmed];
    playVoiceQueue();
  }, [playVoiceQueue, voiceEnabled]);

  const stopPracticeVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  const sayPractice = useCallback((
    message,
    { force = false, intent, speak = true, log = true } = {}
  ) => {
    const feedbackIntent = intent || getPracticeFeedbackIntent(message);
    if (!force && feedbackIntent === lastPracticeFeedbackIntentRef.current) return;

    lastPracticeFeedbackIntentRef.current = feedbackIntent;
    setAssistantMessage(message);
    if (textEnabled && log) {
      appendConversation({ role: "ai", text: message });
    }
    if (voiceEnabled && speak) {
      queuePracticeVoice(message, { force, intent: feedbackIntent });
    }
  }, [appendConversation, queuePracticeVoice, textEnabled, voiceEnabled]);

  const selectTargetReps = useCallback((count) => {
    setTargetReps(count);
    sayPractice(
      buildPracticeSetMessage({ gapMs: countGapMs, reps: count }),
      { intent: `set_config:${count}:${countGapMs}`, speak: true }
    );
  }, [countGapMs, sayPractice]);

  const selectCountGap = useCallback((gapMs) => {
    setCountGapMs(gapMs);
    sayPractice(
      buildPracticeSetMessage({ gapMs, reps: targetReps }),
      { intent: `set_config:${targetReps}:${gapMs}`, speak: true }
    );
  }, [sayPractice, targetReps]);

  const postPracticeRep = useCallback(async (nextRep, repAccuracy, durationMs, focus, issue) => {
    const activeSession = sessionRef.current;
    const token = localStorage.getItem("token");
    if (!activeSession?.id || !token) return;

    const qualityLabel = repAccuracy >= CLEAN_ACCURACY ? "clean" : "shaky";
    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/reps`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rep_number: nextRep,
          accuracy: repAccuracy,
          duration_ms: durationMs,
          speed_label: speedLabel(durationMs),
          quality_label: qualityLabel,
          focus_body_part: focus,
          issue
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data.session);
        sessionRef.current = data.session;
      }
    } catch {
      // Keep counting quiet; local rep state continues even if analysis storage misses a beat.
    }
  }, []);

  const completePracticeSession = useCallback(async (status = "completed") => {
    const activeSession = sessionRef.current;
    const token = localStorage.getItem("token");
    if (!activeSession?.id || !token) {
      if (activeSession) {
        const updatedSession = { ...activeSession, status };
        sessionRef.current = updatedSession;
        setSession(updatedSession);
      }
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions/${activeSession.id}/complete`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
        await loadPracticeAnalysis();
      }
    } catch {
      sayPractice("Set complete locally. Analysis storage did not update.");
    }
  }, [loadPracticeAnalysis, sayPractice]);

  const storePracticeTape = useCallback(async (sessionId, frames, metadata) => {
    const token = localStorage.getItem("token");
    if (!sessionId || !token || !frames.length) return false;

    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions/${sessionId}/tape`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: 1,
          frame_rate: 30,
          duration_ms: Math.round(frames[frames.length - 1]?.elapsedMs || 0),
          frames: frames.map(encodePracticeTapeFrame),
          metadata
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const clearCountBeatTimers = useCallback(() => {
    countBeatTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    countBeatTimersRef.current = [];
    stepScanTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    stepScanTimersRef.current = [];
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
  }, []);

  const beginIntervalStepScan = useCallback(() => {
    stepScanTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    stepScanTimersRef.current = [];
    cycleStepResultsRef.current = [];
    setSelectedStepIndex(0);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;

    if (steps.length <= 1) return;

    const sliceMs = countGapMs / steps.length;
    stepScanTimersRef.current = steps.slice(1).map((_, offset) =>
      window.setTimeout(() => {
        const nextStepIndex = offset + 1;
        setSelectedStepIndex(nextStepIndex);
      }, Math.round(sliceMs * (offset + 1)))
    );
  }, [countGapMs, steps]);

  const runPracticeCountBeat = useCallback(async () => {
    if (sessionRef.current?.status !== "active") return;

    const nextRep = repCountRef.current + 1;
    const countStartedAt = performance.now();
    repStartedAtRef.current = countStartedAt;
    repCountRef.current = nextRep;
    countMarkersRef.current.push({
      rep: nextRep,
      elapsedMs: Math.round(countStartedAt - (setStartedAtRef.current || countStartedAt))
    });
    setRepCount(nextRep);
    setTapeCursor(nextRep - 1);
    setTapeStepCursor(0);
    setAssistantMessage(String(nextRep));
    if (textEnabled) {
      appendConversation({ role: "ai", text: String(nextRep) });
    }

    beginIntervalStepScan();
    recoveryEndsAtRef.current = countStartedAt + countGapMs;
    setRecoveryRemainingMs(countGapMs);

    if (voiceEnabled) {
      playPracticeAudio(
        String(nextRep),
        numberAudioRef.current[nextRep - 1],
        voiceRequestIdRef.current
      );
    }
    const intervalTimerId = window.setTimeout(async () => {
      if (sessionRef.current?.status !== "active") return;

      const intervalEndedAt = performance.now();
      const durationMs = Math.round(intervalEndedAt - countStartedAt);
      const capturedSteps = cycleStepResultsRef.current;
      const scoredSteps = capturedSteps.filter(Boolean);
      const stepResults = steps.map((step, index) => {
        const captured = capturedSteps[index];
        return {
          step: index + 1,
          name: step?.step_name || `Step ${index + 1}`,
          accuracy: captured?.accuracy || 0,
          captured: Boolean(captured),
          focusBodyPart: captured?.focusBodyPart || null,
          issue: captured?.issue || "not_reached",
          landmarks: captured?.landmarks || []
        };
      });
      const repAccuracy = stepResults.length
        ? Math.round(
            stepResults.reduce((total, stepResult) => total + stepResult.accuracy, 0) /
              stepResults.length
          )
        : latestPracticeResultRef.current.accuracy;
      const weakestStep = scoredSteps.reduce(
        (weakest, stepResult) =>
          !weakest || stepResult.accuracy < weakest.accuracy ? stepResult : weakest,
        null
      );
      const fallbackResult = latestPracticeResultRef.current;
      const focus = weakestStep?.focusBodyPart || fallbackResult.focusBodyPart;
      const issue = weakestStep?.issue || fallbackResult.issue;
      const countMarker = countMarkersRef.current[nextRep - 1];

      setCleanReps((value) => value + (repAccuracy >= CLEAN_ACCURACY ? 1 : 0));
      setRepTape((entries) => [
        ...entries,
        {
          rep: nextRep,
          elapsedMs: countMarker?.elapsedMs || 0,
          durationMs,
          accuracy: repAccuracy,
          clean: repAccuracy >= CLEAN_ACCURACY,
          focusBodyPart: focus,
          issue,
          landmarks: latestLandmarksRef.current.map((point) => ({ ...point })),
          stepResults
        }
      ]);
      const saveRepPromise = postPracticeRep(
        nextRep,
        repAccuracy,
        durationMs,
        focus,
        issue
      );

      if (nextRep < targetReps) {
        countBeatRef.current?.();
        await saveRepPromise;
        return;
      }

      await saveRepPromise;
      clearCountBeatTimers();
      const tapeDurationMs = Math.round(
        intervalEndedAt - (setStartedAtRef.current || intervalEndedAt)
      );
      const completedTape = buildThirtyFpsTape(recordedFramesRef.current, tapeDurationMs);
      const analyzedTape = analyzeCountAttention(
        completedTape,
        countMarkersRef.current,
        countGapMs
      );
      const tapeMetadata = {
        sessionId: sessionRef.current?.id || null,
        targetReps,
        countGapMs,
        techniqueName: currentTechnique?.name || "Practice",
        steps: steps.map((step, index) => ({
          id: step?.id ?? index,
          step_name: step?.step_name || `Step ${index + 1}`
        }))
      };
      setFullTapeFrames(analyzedTape);
      setAnalysisTapeMetadata(tapeMetadata);
      setFullTapeCursor(0);
      setIsFullTapePlaying(false);
      setIsTapePopupExpanded(true);
      setIsCameraRollExpanded(false);
      setCameraRollZoom(3);
      setAnalysisCountFilter("all");
      setAnalysisStepFilter("all");
      sessionRef.current = { ...sessionRef.current, status: "completed" };
      await completePracticeSession("completed");
      sayPractice(
        "Stop. Set finished. Your movement tape and full sequence analysis are ready.",
        { force: true, intent: `set_finished:${targetReps}`, speak: true }
      );
      setIsTapePopupOpen(true);
      await storePracticeTape(sessionRef.current?.id, analyzedTape, tapeMetadata);
    }, countGapMs);
    countBeatTimersRef.current = [intervalTimerId];
  }, [
    appendConversation,
    beginIntervalStepScan,
    clearCountBeatTimers,
    completePracticeSession,
    countGapMs,
    currentTechnique,
    playPracticeAudio,
    postPracticeRep,
    sayPractice,
    steps,
    storePracticeTape,
    targetReps,
    textEnabled,
    voiceEnabled
  ]);

  countBeatRef.current = runPracticeCountBeat;

  const startPracticeForStep = useCallback(async (stepIndex = 0, { intro = true } = {}) => {
    if (!currentTechnique) return;

    if (attentionReminderTimerRef.current) {
      window.clearTimeout(attentionReminderTimerRef.current);
      attentionReminderTimerRef.current = null;
    }

    const startIndex = steps[stepIndex] ? stepIndex : 0;

    clearCountBeatTimers();
    stopPracticeVoice();
    const requestId = voiceRequestIdRef.current;
    const token = localStorage.getItem("token");
    sessionRef.current = LOCAL_SESSION;
    setSession(LOCAL_SESSION);
    setSelectedStepIndex(startIndex);
    setRepCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    countMarkersRef.current = [];
    previousRecordedLandmarksRef.current = [];
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    setStartedAtRef.current = null;
    repStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(false);
    isReadyForRepRef.current = false;

    const setupIntent = `set_start:${targetReps}:${countGapMs}:${startIndex}`;
    const setupMessage = intro
      ? `${buildPracticeSetMessage({
          gapMs: countGapMs,
          reps: targetReps,
          started: true,
          stepName: steps[startIndex]?.step_name || currentTechnique.name
        })} Sequence: all ${steps.length} ${steps.length === 1 ? "step" : "steps"}. Start.`
      : `Step ${startIndex + 1}: ${steps[startIndex]?.step_name || "continue the movement"}. I will count completed reps only.`;
    sayPractice(setupMessage, { intent: setupIntent, speak: false });

    numberAudioRef.current = voiceEnabled
      ? await Promise.all(
          Array.from({ length: targetReps }, (_, index) =>
            fetchPracticeVoice(String(index + 1))
          )
        )
      : [];
    const setupAudio = voiceEnabled ? await fetchPracticeVoice(setupMessage) : null;
    if (voiceEnabled) {
      lastPracticeSpokenIntentRef.current = setupIntent;
      await playPracticeAudio(setupMessage, setupAudio, requestId);
    }
    if (requestId !== voiceRequestIdRef.current) return;
    const rhythmStartedAt = performance.now();
    setStartedAtRef.current = rhythmStartedAt;
    repStartedAtRef.current = rhythmStartedAt;
    const recordFrame = () => {
      const now = performance.now();
      const landmarks = latestLandmarksRef.current.map((point) => ({ ...point }));
      const holisticFrame = latestHolisticFrameRef.current;
      const poseMotion = getPoseMotion(previousRecordedLandmarksRef.current, landmarks);
      previousRecordedLandmarksRef.current = landmarks;
      recordedFramesRef.current.push({
        elapsedMs: now - rhythmStartedAt,
        rep: Math.min(repCountRef.current + 1, targetReps),
        step: selectedStepIndexRef.current + 1,
        accuracy: latestPracticeResultRef.current.accuracy,
        focusBodyPart: latestPracticeResultRef.current.focusBodyPart,
        issue: latestPracticeResultRef.current.issue,
        wrongBodyParts: [...(latestPracticeResultRef.current.wrongBodyParts || [])],
        landmarks,
        facePoints: (holisticFrame.facePoints || [])
          .filter((point) => holisticFrame.faceSource === "pose33" || TAPE_FACE_INDICES.has(point.index))
          .map((point) => ({ ...point })),
        faceSource: holisticFrame.faceSource || "pose33",
        handPoints: Object.fromEntries(
          Object.entries(holisticFrame.handPoints || {}).map(([side, points]) => [
            side,
            points.map((point) => ({ ...point }))
          ])
        ),
        motionScore: Math.max(holisticFrame.motionEnergy || 0, poseMotion * 10)
      });
    };
    recordFrame();
    recordingTimerRef.current = window.setInterval(recordFrame, 1000 / 30);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    countBeatRef.current?.();

    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/practice/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          technique_name: currentTechnique.name,
          step_key: "full_sequence",
          step_name: `${currentTechnique.name}: ${steps
            .map((step) => step.step_name)
            .join(" → ")}`,
          target_reps: targetReps
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(data);
        sessionRef.current = data;
      }
    } catch {
      sayPractice("Practice started locally. Analysis storage is offline.", {
        log: false
      });
    }
  }, [
    clearCountBeatTimers,
    countGapMs,
    currentTechnique,
    fetchPracticeVoice,
    playPracticeAudio,
    sayPractice,
    steps,
    stopPracticeVoice,
    targetReps,
    voiceEnabled
  ]);

  const startPractice = useCallback(() => {
    startPracticeForStep(0);
  }, [startPracticeForStep]);

  const resetPractice = useCallback(() => {
    completePracticeSession("cancelled");
    clearCountBeatTimers();
    stopPracticeVoice();
    setSession(null);
    sessionRef.current = null;
    setRepCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    countMarkersRef.current = [];
    previousRecordedLandmarksRef.current = [];
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    numberAudioRef.current = [];
    setStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice("Reset. Choose a count and start when ready.", { force: true, speak: true });
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    stopPracticeVoice
  ]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopPracticeVoice();
    }
  }, [stopPracticeVoice, voiceEnabled]);

  const moveToPracticeStep = useCallback((nextIndex, { cancelSession = true } = {}) => {
    if (nextIndex < 0 || nextIndex >= steps.length) return false;
    if (cancelSession) {
      completePracticeSession("cancelled");
    }
    clearCountBeatTimers();
    setSession(null);
    sessionRef.current = null;
    setSelectedStepIndex(nextIndex);
    setRepCount(0);
    setCleanReps(0);
    setRepTape([]);
    setTapeCursor(0);
    setTapeStepCursor(0);
    setIsTapePlaying(false);
    setFullTapeFrames([]);
    setAnalysisTapeMetadata(null);
    setFullTapeCursor(0);
    setIsFullTapePlaying(false);
    setIsTapePopupOpen(false);
    recordedFramesRef.current = [];
    repCountRef.current = 0;
    cycleStepResultsRef.current = [];
    setStartedAtRef.current = null;
    recoveryEndsAtRef.current = null;
    setRecoveryRemainingMs(0);
    setIsReadyForRep(true);
    isReadyForRepRef.current = true;
    sayPractice(`Step ${nextIndex + 1}. Are you ready to start?`, { speak: true });
    return true;
  }, [
    clearCountBeatTimers,
    completePracticeSession,
    sayPractice,
    steps.length
  ]);

  const handlePracticeCommand = useCallback((message) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }

    const command = classifyPracticeCommand(trimmed);
    const activeSession = sessionRef.current?.status === "active";

    if (activeSession && command.intent === "set_count") {
      sayPractice("This set is active. Reset before changing the rep count.", {
        speak: true
      });
      return;
    }

    if (activeSession && command.intent === "start") {
      sayPractice("The set is already running. Continue your current rep, or say reset.", {
        speak: true
      });
      return;
    }

    if (activeSession && command.intent === "wait") {
      sayPractice("This set is active. Say reset if you need to stop and rebuild it.", {
        speak: true
      });
      return;
    }

    if (command.intent === "set_count") {
      setTargetReps(command.count);
      sayPractice(`Count set to ${command.count}. Say start when ready.`, {
        speak: true
      });
      return;
    }

    if (command.intent === "wait") {
      sayPractice("No rush. I will wait. Say start when you are ready.", { speak: true });
      return;
    }

    if (command.intent === "reset") {
      resetPractice();
      return;
    }

    if (command.intent === "start") {
      startPractice();
      return;
    }

    if (command.intent === "next") {
      if (!moveToPracticeStep(selectedStepIndex + 1)) {
        sayPractice("This is the last practice step. Practice again or view analysis.", {
          speak: true
        });
      }
      return;
    }

    if (command.intent === "previous") {
      if (!moveToPracticeStep(selectedStepIndex - 1)) {
        sayPractice("This is the first practice step.", { speak: true });
      }
      return;
    }

    if (command.intent === "train") {
      onModeChange?.("train");
      return;
    }

    if (command.intent === "analysis") {
      onModeChange?.("analysis");
      return;
    }

    sayPractice("Say start, reset, next step, train, analysis, or count 3, 5, or 10.");
  }, [
    appendConversation,
    moveToPracticeStep,
    onModeChange,
    resetPractice,
    sayPractice,
    selectedStepIndex,
    startPractice,
    textEnabled
  ]);

  const handleAngleUpdate = useCallback((liveAngles) => {
    const result = scorePracticeAngles(requiredParts, liveAngles);
    latestPracticeResultRef.current = result;
    setAccuracy(result.accuracy);
    setFocusBodyPart(result.focusBodyPart);

    if (sessionRef.current?.status !== "active") return;

    const stepIndex = selectedStepIndex;
    const savedResult = cycleStepResultsRef.current[stepIndex];
    if (!savedResult || result.accuracy > savedResult.accuracy) {
      cycleStepResultsRef.current[stepIndex] = {
        ...result,
        landmarks: latestLandmarksRef.current.map((point) => ({ ...point }))
      };
    }
  }, [
    requiredParts,
    selectedStepIndex
  ]);

  const stopVoiceInput = useCallback((status = "Voice commands are off.") => {
    shouldListenRef.current = false;
    setIsListening(false);
    setVoiceInputStatus(status);

    if (restartListenTimerRef.current) {
      window.clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const startVoiceInput = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition || recognitionRef.current) {
      if (!SpeechRecognition) {
        setVoiceInputStatus("Voice commands are not supported in this browser.");
      }
      return;
    }

    shouldListenRef.current = true;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceInputStatus("Listening. Say start, reset, next, train, or analysis.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (shouldListenRef.current) {
        restartListenTimerRef.current = window.setTimeout(() => {
          startVoiceInputRef.current?.();
        }, 650);
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setIsListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setVoiceInputStatus("Microphone permission is blocked.");
        return;
      }
      setVoiceInputStatus("Voice command paused. Type or try again.");
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result?.isFinal) {
          finalTranscript += ` ${transcript}`;
        } else if (transcript.trim()) {
          setVoiceInputStatus(`Hearing: ${transcript.trim()}`);
        }
      }

      const command = finalTranscript.trim();
      if (command) {
        setVoiceInputStatus(`Command heard: ${command}`);
        finalTranscript = "";
        recognition.stop();
        handlePracticeCommand(command);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceInputStatus("Voice command could not start.");
    }
  }, [handlePracticeCommand]);

  useEffect(() => {
    startVoiceInputRef.current = startVoiceInput;
  }, [startVoiceInput]);

  useEffect(() => {
    if (!currentTechnique || greetedTechniqueRef.current === currentTechnique.name) {
      return;
    }

    greetedTechniqueRef.current = currentTechnique.name;
    const greeting = `Welcome to ${currentTechnique.name}. Set your reps and time gap, then start when ready.`;
    const greetingIntent = getPracticeFeedbackIntent(greeting);
    lastPracticeFeedbackIntentRef.current = greetingIntent;
    setAssistantMessage(greeting);
    setConversation([{ role: "ai", text: greeting }]);
    if (voiceEnabled) {
      queuePracticeVoice(greeting, { intent: greetingIntent });
    }
  }, [currentTechnique, queuePracticeVoice, voiceEnabled]);

  useEffect(() => {
    if (attentionReminderTimerRef.current) {
      window.clearTimeout(attentionReminderTimerRef.current);
      attentionReminderTimerRef.current = null;
    }

    if (isPracticeActive || !currentTechnique) return undefined;

    attentionReminderTimerRef.current = window.setTimeout(() => {
      if (sessionRef.current?.status === "active") {
        attentionReminderTimerRef.current = null;
        return;
      }

      const reminder = session?.status === "completed"
        ? "Still with me? Choose practice again, training mode, or analysis."
        : "Still with me? Choose your reps, then say start when ready.";
      sayPractice(reminder, { speak: true });
      attentionReminderTimerRef.current = null;
    }, 15000);

    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
        attentionReminderTimerRef.current = null;
      }
    };
  }, [currentTechnique, isPracticeActive, sayPractice, session?.status]);

  useEffect(() => {
    return () => {
      if (attentionReminderTimerRef.current) {
        window.clearTimeout(attentionReminderTimerRef.current);
      }
      clearCountBeatTimers();
      stopVoiceInput();
      stopPracticeVoice();
    };
  }, [clearCountBeatTimers, stopPracticeVoice, stopVoiceInput]);

  const openHistorySession = useCallback(async (historySession) => {
    if (
      historySession.id === analysisTapeMetadata?.sessionId &&
      fullTapeFrames.length
    ) {
      setIsTapePopupExpanded(true);
      setIsTapePopupOpen(true);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      setHistorySessionPopup(historySession);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/practice/sessions/${historySession.id}/tape`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        setHistorySessionPopup(historySession);
        return;
      }

      const data = await response.json();
      const restoredFrames = (data.frames || [])
        .map(decodePracticeTapeFrame)
        .sort((left, right) => left.elapsedMs - right.elapsedMs);
      if (!restoredFrames.length) {
        setHistorySessionPopup(historySession);
        return;
      }
      const restoredSteps = data.metadata?.steps || [];
      setFullTapeFrames(restoredFrames);
      setAnalysisTapeMetadata({
        ...(data.metadata || {}),
        sessionId: historySession.id,
        repTape: buildRepTapeFromFrames(restoredFrames, restoredSteps)
      });
      setFullTapeCursor(0);
      setIsFullTapePlaying(false);
      setAnalysisCountFilter("all");
      setAnalysisStepFilter("all");
      setCameraRollZoom(3);
      setHistorySessionPopup(null);
      setIsTapePopupExpanded(true);
      setIsTapePopupOpen(true);
    } catch {
      setHistorySessionPopup(historySession);
    }
  }, [analysisTapeMetadata?.sessionId, fullTapeFrames.length]);

  if (!currentTechnique) {
    return (
      <aside className="practice-panel">
        <div className="panel-block">
          <p className="eyebrow">Practice Mode</p>
          <h1>No technique selected</h1>
          <p className="practice-copy">Open a technique before starting fixed-count practice.</p>
        </div>
      </aside>
    );
  }

  const overallKpi = practiceAnalysis?.summary;
  const recentSet = practiceAnalysis?.sessions?.find(
    (practiceSession) => practiceSession.status === "completed"
  ) || practiceAnalysis?.sessions?.[0];
  const sortedPracticeSessions = [...(practiceAnalysis?.sessions || [])].sort(
    (left, right) => {
      const leftTime = new Date(left.ended_at || left.started_at || 0).getTime() || 0;
      const rightTime = new Date(right.ended_at || right.started_at || 0).getTime() || 0;
      return sessionSortDirection === "desc"
        ? rightTime - leftTime
        : leftTime - rightTime;
    }
  );

  return (
    <>
      <section
        className="training-stage training-stage--practice"
        aria-label="Practice mode camera tracking"
      >
        <SkeletonCanvas
          enableCoach={false}
          enableAwareness={false}
          performanceProfile={performanceProfile}
          performanceMode={performanceMode}
          displayMirrored={displayMirrored}
          skeletonLayers={practiceSkeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          currentStepId={selectedStep?.id}
          currentStepName={selectedStep?.step_name}
          requiredParts={requiredParts}
          onAngleUpdate={handleAngleUpdate}
          onLandmarkFrame={handleLandmarkFrame}
          onLevel1Update={handleLevel1Update}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onAccuracyUpdate={() => {}}
          onFeedbackUpdate={() => {}}
          onSummaryUpdate={() => {}}
        />
        {isPracticeActive ? (
          <div className="practice-count-cue" role="status">
            <span>AI LEAD</span>
            <strong>{repCount ? repCount : "START"}</strong>
            <small>
              {recoveryRemainingMs > 0
                ? `Next count in ${(recoveryRemainingMs / 1000).toFixed(1)}s`
                : isReadyForRep ? "Move — I’m watching the rep" : "Reading movement"}
            </small>
          </div>
        ) : null}
      </section>

      <div
        aria-live={practiceNeedsReply ? "assertive" : "polite"}
        className={`feedback-banner feedback-banner--practice ${practiceNeedsReply ? "feedback-banner--attention" : ""}`}
      >
        <div className="feedback-banner__message" role={practiceNeedsReply ? "alert" : "status"}>
          <div className="master-status-row">
            <p className="eyebrow">Practice Guidance</p>
            <span className="master-status">
              {session?.status === "active"
                ? recoveryRemainingMs > 0 ? "Pacing" : "Counting"
                : session?.status === "completed" ? "Finished" : "Waiting"}
            </span>
            {focusBodyPart && session?.status !== "active" ? (
              <span className="master-focus">Focus: {formatBodyPart(focusBodyPart)}</span>
            ) : null}
          </div>
          <span>{textEnabled ? assistantMessage : "Text feedback is off."}</span>
        </div>
      </div>

      <aside className="practice-setup-panel practice-workspace-panel" aria-label="Practice workspace controls">
        <div className="panel-block practice-technique-card">
          <p className="eyebrow">Practice Mode</p>
          <h1>{currentTechnique.name}</h1>
          <p className="technique-meta">
            {currentTechnique.subcategory} / {currentTechnique.difficulty}
          </p>
        </div>

        <div className="panel-block practice-setup-summary">
          <div className="practice-setup-summary__top">
            <div>
              <p className="eyebrow">Set Builder</p>
              <h2>{session?.status === "completed" ? "Set complete" : isPracticeActive ? "Set in progress" : "Build your set"}</h2>
            </div>
            <span className={`practice-state ${isPracticeActive ? "practice-state--active" : ""}`}>
              {session?.status === "completed" ? "Complete" : isPracticeActive ? "Live" : "Ready"}
            </span>
          </div>
          <p>
            {isPracticeActive
              ? `${Math.max(targetReps - repCount, 0)} reps remaining. Follow the fixed count; form is being scored in the background.`
              : "Choose a rep count and count gap. Accuracy will be recorded without delaying the rhythm."}
          </p>
        </div>

        <div className="panel-block practice-controls">
          <div className="practice-control-heading">
            <p className="eyebrow">Repetitions</p>
            <span>{targetReps} total</span>
          </div>
          <div className="rep-count-options">
            {COUNT_OPTIONS.map((count) => (
              <button
                aria-pressed={count === targetReps}
                className={count === targetReps ? "is-active" : ""}
                disabled={isPracticeActive}
                key={count}
                onClick={() => selectTargetReps(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
          <label className="practice-custom-count">
            <span>Custom count</span>
            <input
              disabled={isPracticeActive}
              max="50"
              min="1"
              onChange={(event) => {
                const nextCount = Math.max(1, Math.min(50, Number(event.target.value) || 1));
                setTargetReps(nextCount);
              }}
              type="number"
              value={targetReps}
            />
          </label>
          <div className="practice-control-heading">
            <p className="eyebrow">Count gap</p>
            <span>{GAP_OPTIONS.find((gap) => gap.value === countGapMs)?.label}</span>
          </div>
          <div className="rep-count-options">
            {GAP_OPTIONS.map((gap) => (
              <button
                aria-pressed={gap.value === countGapMs}
                className={gap.value === countGapMs ? "is-active" : ""}
                disabled={isPracticeActive}
                key={gap.value}
                onClick={() => selectCountGap(gap.value)}
                type="button"
              >
                {gap.label}
              </button>
            ))}
          </div>
          <div className="practice-actions">
            <button className="btn btn--light" disabled={isPracticeActive} onClick={startPractice} type="button">
              {isPracticeActive ? "Set running" : session?.status === "completed" ? "Start again" : "Start set"}
            </button>
            <button className="btn btn--ghost" onClick={resetPractice} type="button">
              {isPracticeActive ? "Stop set" : "Reset"}
            </button>
          </div>
        </div>

        <div className="practice-stats practice-stats--side">
          <div>
            <span>Reps</span>
            <strong>{repCount}/{targetReps}</strong>
          </div>
          <div>
            <span>Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div>
            <span>Clean</span>
            <strong>{cleanReps}</strong>
          </div>
          <div>
            <span>Focus</span>
            <strong>{formatBodyPart(focusBodyPart)}</strong>
          </div>
          <div>
            <span>Step scan</span>
            <strong>{isReadyForRep ? `Step ${selectedStepIndex + 1}` : "Advancing"}</strong>
          </div>
        </div>

        <div className={`panel-block practice-tape practice-tape--left ${session?.status === "completed" ? "practice-tape--complete" : ""}`}>
          <div className="practice-tape__header">
            <div>
              <p className="eyebrow">Session tape</p>
              <strong>{repTape.length ? `${repTape.length} / ${targetReps} counts` : "Ready to record"}</strong>
            </div>
            <div className="practice-tape__header-actions">
              {fullTapeFrames.length ? (
                <button onClick={() => setIsTapePopupOpen(true)} type="button">
                  Full tape
                </button>
              ) : null}
              <button
                disabled={repTape.length < 2}
                onClick={() => {
                  if (!isTapePlaying && tapeCursor >= repTape.length - 1) {
                    setTapeCursor(0);
                    setTapeStepCursor(0);
                  }
                  setIsTapePlaying((playing) => !playing);
                }}
                type="button"
              >
                {isTapePlaying ? "Pause" : "Play"}
              </button>
            </div>
          </div>

          <div className="practice-tape__viewer">
            <TapeSkeleton
              landmarks={selectedTapeStep?.landmarks || selectedTapeRep?.landmarks}
              mirrored={displayMirrored}
            />
            <div className="practice-tape__readout">
              <span>{selectedTapeRep ? `COUNT ${selectedTapeRep.rep}` : "NO COUNT YET"}</span>
              <strong>{selectedTapeRep ? `${selectedTapeRep.accuracy}%` : "--"}</strong>
              <small>
                {selectedTapeRep
                  ? `${(selectedTapeRep.durationMs / 1000).toFixed(1)}s interval · ${selectedTapeRep.clean ? "clean" : "review"}`
                  : "Start the set to capture movement"}
              </small>
              {selectedTapeStep ? (
                <small>
                  Step {selectedTapeStep.step} · {selectedTapeStep.captured
                    ? `${selectedTapeStep.accuracy}%`
                    : "not captured"}
                </small>
              ) : null}
              {selectedTapeRep?.focusBodyPart ? (
                <small>Focus · {formatBodyPart(selectedTapeRep.focusBodyPart)}</small>
              ) : null}
            </div>
          </div>

          {selectedTapeRep?.stepResults?.length ? (
            <div className="practice-tape__steps" aria-label={`Count ${selectedTapeRep.rep} step accuracy`}>
              {selectedTapeRep.stepResults.map((stepResult, index) => (
                <button
                  aria-pressed={index === tapeStepCursor}
                  className={`${index === tapeStepCursor ? "is-current" : ""} ${stepResult.captured ? "" : "is-missing"}`}
                  key={`${selectedTapeRep.rep}-${stepResult.step}`}
                  onClick={() => setTapeStepCursor(index)}
                  title={stepResult.name}
                  type="button"
                >
                  <span>S{stepResult.step}</span>
                  <strong>{stepResult.captured ? `${stepResult.accuracy}%` : "--"}</strong>
                </button>
              ))}
            </div>
          ) : null}

          <div className="practice-tape__ruler" aria-label="Set timeline">
            <div className="practice-tape__track" />
            {repTape.map((entry, index) => (
              <button
                aria-label={`Count ${entry.rep} at ${formatTapeTime(entry.elapsedMs)}`}
                className={`${index === tapeCursor ? "is-current" : ""} ${entry.clean ? "is-clean" : "is-review"}`}
                key={entry.rep}
                onClick={() => {
                  setIsTapePlaying(false);
                  setTapeCursor(index);
                  setTapeStepCursor(0);
                }}
                style={{ left: `${tapeDurationMs ? (entry.elapsedMs / tapeDurationMs) * 100 : 0}%` }}
                type="button"
              >
                <b>{entry.rep}</b>
                <span>{formatTapeTime(entry.elapsedMs)}</span>
              </button>
            ))}
          </div>
          <div className="practice-tape__scale">
            <span>START · 0:00.0</span>
            <span>{session?.status === "completed" ? "FINISH" : "LIVE"} · {formatTapeTime(tapeDurationMs)}</span>
          </div>
        </div>

      </aside>

      <aside className="training-panel training-panel--right practice-analysis-panel" aria-label="Practice analysis">
        <div className="panel-block practice-analysis-heading">
          <p className="eyebrow">Practice Analysis</p>
          <h2>{session?.status === "completed" ? "Set performance" : "Performance overview"}</h2>
          <p>
            {session?.status === "completed"
              ? "The tape is saved below your set controls. Review overall form and the recommended next action here."
              : "Accuracy is measured for analysis while the AI keeps the selected counting rhythm."}
          </p>
        </div>

        {isAdminStudio ? (
          <>
            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showAdvancedAnalysis}
                className="advanced-analysis-button"
                onClick={() => setShowAdvancedAnalysis((isVisible) => !isVisible)}
                type="button"
              >
                Advanced Analysis
                <span>{showAdvancedAnalysis ? "Hide" : "Expand"}</span>
              </button>
              {showAdvancedAnalysis ? (
                <>
                  <ActionSkeletonOverlay level2State={level2State} variant="panel" />
                  <Level1DebugPanel state={level1State} />
                  <Level2DebugPanel state={level2State} />
                </>
              ) : null}
            </div>

            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showDataLayers}
                className="advanced-analysis-button"
                onClick={() => setShowDataLayers((isVisible) => !isVisible)}
                type="button"
              >
                Data Layers
                <span>{showDataLayers ? "Hide" : "Expand"}</span>
              </button>
              {showDataLayers ? (
                <DataLayersPanel
                  level1State={level1State}
                  level2State={level2State}
                  level3State={level3State}
                  level4State={level4State}
                  situationAwarenessState={situationAwarenessState}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <div className="panel-block practice-kpi-card">
          <div className="panel-heading">
            <p className="eyebrow">Overall KPI</p>
            <span>Last 12 sets</span>
          </div>
          <div className="practice-kpi-grid">
            <div><span>Avg form</span><strong>{overallKpi ? `${overallKpi.average_accuracy}%` : "--"}</strong></div>
            <div><span>Clean rate</span><strong>{overallKpi ? `${overallKpi.clean_rate}%` : "--"}</strong></div>
            <div><span>Consistency</span><strong>{overallKpi ? `${overallKpi.consistency_score}%` : "--"}</strong></div>
            <div><span>Total reps</span><strong>{overallKpi?.total_reps ?? "--"}</strong></div>
          </div>
        </div>

        <div className="panel-block practice-recent-set">
          <div className="panel-heading">
            <p className="eyebrow">Recent Set</p>
            <time dateTime={recentSet?.ended_at || recentSet?.started_at || undefined}>
              {formatSessionTimestamp(recentSet?.ended_at || recentSet?.started_at)}
            </time>
          </div>
          {recentSet ? (
            <>
              <strong className="practice-recent-set__name">{recentSet.technique_name}</strong>
              <div className="practice-recent-set__metrics">
                <span><small>Reps</small><strong>{recentSet.completed_reps}/{recentSet.target_reps}</strong></span>
                <span><small>Average</small><strong>{recentSet.average_accuracy}%</strong></span>
                <span><small>Clean</small><strong>{recentSet.clean_reps}</strong></span>
              </div>
            </>
          ) : (
            <p className="empty-state">Complete a set to create your first analysis.</p>
          )}
        </div>

        <div className="panel-block practice-session-history">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Session history</p>
              <strong>Sorted by timestamp</strong>
            </div>
            <button
              aria-label={`Sort sessions ${sessionSortDirection === "desc" ? "oldest first" : "newest first"}`}
              onClick={() =>
                setSessionSortDirection((direction) =>
                  direction === "desc" ? "asc" : "desc"
                )
              }
              type="button"
            >
              {sessionSortDirection === "desc" ? "Newest ↓" : "Oldest ↑"}
            </button>
          </div>
          {sortedPracticeSessions.length ? (
            <div className="practice-session-history__list">
              {sortedPracticeSessions.map((historySession) => {
                const timestamp = historySession.ended_at || historySession.started_at;
                return (
                  <article
                    key={`practice-history-${historySession.id}`}
                  >
                    <button
                      aria-label={`Open ${historySession.technique_name} session from ${formatSessionTimestamp(timestamp)}`}
                      className="practice-session-history__summary"
                      onClick={() => openHistorySession(historySession)}
                      type="button"
                    >
                      <span>
                        <strong>{historySession.technique_name}</strong>
                        <time dateTime={timestamp || undefined}>
                          {formatSessionTimestamp(timestamp)}
                        </time>
                      </span>
                      <span>
                        <strong>{historySession.average_accuracy}%</strong>
                        <i>↗</i>
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">Completed sessions will appear here by timestamp.</p>
          )}
        </div>

        <div className="panel-block coach-card practice-analysis-action">
          <p className="eyebrow">Next action</p>
          <strong>
            {session?.status === "completed"
              ? "Review this set while the movement is still fresh."
              : overallKpi?.recommendation || "Complete a set to unlock your recommendation."}
          </strong>
          <button
            className="btn btn--light btn--full"
            onClick={() => onModeChange?.("analysis")}
            type="button"
          >
            Open full analysis
          </button>
        </div>
      </aside>

      <aside className="conversation-crate conversation-crate--practice" aria-label="Talk to practice assistant">
        <div className="conversation-crate__header">
          <div>
            <p className="eyebrow">Student Reply</p>
            <strong>{isListening ? "Listening" : voiceInputStatus}</strong>
          </div>
          <button
            className="conversation-listen"
            onClick={isListening ? stopVoiceInput : startVoiceInput}
            type="button"
          >
            {isListening ? "Stop" : "Listen"}
          </button>
          {conversation.length > 2 ? (
            <button
              aria-expanded={showConversationHistory}
              className="conversation-history-toggle"
              onClick={() => setShowConversationHistory((visible) => !visible)}
              type="button"
            >
              {showConversationHistory ? "Latest only" : `History (${conversation.length})`}
            </button>
          ) : null}
        </div>

        <div className="conversation-log">
          {!textEnabled ? (
            <p className="conversation-empty">Text coach is off.</p>
          ) : (
            conversation.slice(showConversationHistory ? -6 : -2).map((item, index) => (
              <p
                className={`conversation-line conversation-line--${item.role}`}
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>{item.role === "ai" ? "Practice Coach" : "You"}</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          {textEnabled && practiceNeedsReply ? (
            <div className="quick-replies" aria-label="Suggested practice replies">
              {practiceReplyOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePracticeCommand(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="coach-command"
            onSubmit={(event) => {
              event.preventDefault();
              handlePracticeCommand(practiceInput);
              setPracticeInput("");
            }}
          >
            <input
              aria-label="Talk to practice assistant"
              onChange={(event) => setPracticeInput(event.target.value)}
              placeholder="Say start, reset, next..."
              value={practiceInput}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </aside>

      {isTapePopupOpen && fullTapeFrames.length ? (
        <section
          aria-label="Full 30 FPS movement tape"
          aria-modal="true"
          className={`practice-tape-popup ${isTapePopupExpanded ? "is-expanded" : "is-compact"} ${isCameraRollExpanded ? "is-sequence-expanded" : ""}`}
          role="dialog"
        >
          <div className="practice-tape-popup__header">
            <div>
              <p className="eyebrow">Full session analysis</p>
              <strong>Skeleton sequence · 30 FPS · {fullTapeFrames.length} frames · {formatTapeTime(fullTapeDurationMs)}</strong>
            </div>
            <div>
              <button
                onClick={() => setIsTapePopupExpanded((expanded) => !expanded)}
                type="button"
              >
                {isTapePopupExpanded ? "Collapse" : "Expand"}
              </button>
              <button
                onClick={() => {
                  setIsFullTapePlaying(false);
                  setIsTapePopupOpen(false);
                }}
                type="button"
              >
                Hide
              </button>
            </div>
          </div>

          <PracticeAccuracyTimeline
            countFilter={analysisCountFilter}
            contentWidth={timelineContentWidth}
            expanded={isCameraRollExpanded}
            frames={fullTapeFrames}
            onScroll={(event) =>
              syncTimelineScroll(event.currentTarget, cameraRollScrollRef)
            }
            onSelectFrame={(frameIndex) => {
              setIsFullTapePlaying(false);
              setFullTapeCursor(frameIndex);
            }}
            scrollRef={accuracyTimelineScrollRef}
            selectedFrame={fullTapeCursor}
            stepFilter={analysisStepFilter}
          />

          <div className="practice-session-analysis">
            <div className="practice-session-analysis__frame">
              <div className="practice-selected-frame__heading">
                <div>
                  <p className="eyebrow">Selected frame</p>
                  <strong>Frame {fullTapeCursor + 1}</strong>
                </div>
                <span className={fullTapeFrame?.accuracy < CLEAN_ACCURACY ? "is-review" : "is-clean"}>
                  {fullTapeFrame?.accuracy < CLEAN_ACCURACY ? "Review" : "Clean"}
                </span>
              </div>
              <TapeSkeleton
                highlightBodyPart={
                  fullTapeFrame?.accuracy < CLEAN_ACCURACY
                    ? fullTapeFrame?.focusBodyPart
                    : null
                }
                highlightBodyParts={
                  fullTapeFrame?.accuracy < CLEAN_ACCURACY
                    ? fullTapeFrame?.wrongBodyParts
                    : []
                }
                landmarks={fullTapeFrame?.landmarks}
                mirrored={displayMirrored}
              />
              <div className="practice-selected-frame__tracking">
                <span>
                  <LandmarkDetailSkeleton
                    kind="face"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.facePoints}
                  />
                  <small>Face</small>
                  <strong>{fullTapeFrame?.faceSource === "mesh" ? "Mesh tracked" : "Pose 33"}</strong>
                </span>
                <span>
                  <LandmarkDetailSkeleton
                    kind="hand"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.handPoints?.left}
                  />
                  <small>Left hand</small>
                  <strong>{(fullTapeFrame?.handPoints?.left?.length || 0) > 4 ? "21 points" : "Pose tracked"}</strong>
                </span>
                <span>
                  <LandmarkDetailSkeleton
                    kind="hand"
                    mirrored={displayMirrored}
                    points={fullTapeFrame?.handPoints?.right}
                  />
                  <small>Right hand</small>
                  <strong>{(fullTapeFrame?.handPoints?.right?.length || 0) > 4 ? "21 points" : "Pose tracked"}</strong>
                </span>
              </div>
            </div>

            <div className="practice-session-analysis__details">
              <p className="eyebrow">Frame and sequence analytics</p>
              <h3>Timestamp, count, form and attention</h3>
              <div className="practice-session-analysis__frame-meta">
                <span><small>Timestamp</small><strong>{formatTapeTime(fullTapeFrame?.elapsedMs || 0)}</strong></span>
                <span><small>Count</small><strong>{fullTapeFrame?.rep || "--"}</strong></span>
                <span><small>Step</small><strong>{fullTapeFrame?.step || "--"}</strong></span>
                <span><small>Accuracy</small><strong>{fullTapeFrame?.accuracy ?? "--"}%</strong></span>
                <span>
                  <small>Count cue</small>
                  <strong className={`is-${fullTapeFrame?.attentionTiming || "no-response"}`}>
                    {fullTapeFrame?.attentionTiming === "on-time"
                      ? "On time"
                      : formatBodyPart(fullTapeFrame?.attentionTiming)}
                  </strong>
                </span>
                <span>
                  <small>Response offset</small>
                  <strong>{formatAttentionOffset(fullTapeFrame?.attentionOffsetMs)}</strong>
                </span>
              </div>
              <div className={`practice-session-analysis__finding ${fullTapeFrame?.accuracy < CLEAN_ACCURACY ? "is-warning" : "is-clean"}`}>
                <span>{fullTapeFrame?.accuracy < CLEAN_ACCURACY ? "Needs review" : "Clean frame"}</span>
                <strong>
                  {fullTapeFrame?.accuracy < CLEAN_ACCURACY && fullTapeFrame?.focusBodyPart
                    ? `${formatBodyPart(fullTapeFrame.focusBodyPart)} · ${formatBodyPart(fullTapeFrame.issue)}`
                    : "Target angles are within range"}
                </strong>
              </div>

              <p className="eyebrow">Full session</p>
              <div className="practice-session-analysis__summary">
                <span><small>Average</small><strong>{fullTapeAverageAccuracy}%</strong></span>
                <span><small>Review frames</small><strong>{fullTapeReviewFrames}</strong></span>
                <span><small>Counts</small><strong>{popupRepTape.length}/{tapeTargetReps}</strong></span>
                <span><small>Consistency</small><strong>{sequenceConsistency}%</strong></span>
                <span><small>Count attention</small><strong>{attentionRate}%</strong></span>
              </div>
              <div className="practice-count-attention">
                <div>
                  <span>Master count timing</span>
                  <strong>Movement is compared with each spoken cue after the full set.</strong>
                </div>
                <div className="practice-count-attention__markers">
                  {countAttentionResults.map((result) => (
                    <button
                      className={`is-${result.timing}`}
                      key={`attention-${result.rep}`}
                      onClick={() => {
                        const markerFrame = fullTapeFrames.findIndex(
                          (frame) =>
                            frame.rep === result.rep &&
                            Math.abs(frame.elapsedMs - (result.timestampMs || 0)) <= 1000 / 30
                        );
                        if (markerFrame >= 0) setFullTapeCursor(markerFrame);
                      }}
                      type="button"
                    >
                      <span>Count {result.rep}</span>
                      <strong>{result.timing === "on-time" ? "On time" : formatBodyPart(result.timing)}</strong>
                      <small>{formatAttentionOffset(result.offsetMs)}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="practice-sequence-intelligence">
                <div>
                  <span>Selected sequence</span>
                  <strong>{sequenceStepStats.length} steps · {formatTapeTime(fullTapeDurationMs)}</strong>
                </div>
                <div className="practice-sequence-intelligence__steps">
                  {sequenceStepStats.map((step) => (
                    <span
                      className={step.step === weakestSequenceStep?.step ? "is-weakest" : ""}
                      key={step.step}
                      title={step.name}
                    >
                      <small>S{step.step}</small>
                      <strong>{step.accuracy}%</strong>
                      <em>{step.coverage}% seen</em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="practice-session-analysis__recommendation">
                <span>AI recommendation</span>
                <strong>{fullTapeRecommendation}</strong>
              </div>
              <div className="practice-session-analysis__legend" aria-label="Skeleton analysis legend">
                <span><i className="is-correct" /> Correct bone</span>
                <span><i className="is-wrong" /> Incorrect angle</span>
              </div>
            </div>
          </div>

          <div className="practice-tape-popup__controls">
            <button
              aria-label="Previous frame"
              onClick={() => {
                setIsFullTapePlaying(false);
                const position = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                const previous = filteredTapeFrames[Math.max(0, position - 1)];
                if (previous) setFullTapeCursor(previous.index);
              }}
              type="button"
            >
              −1f
            </button>
            <button
              onClick={() => {
                const filteredPosition = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                if (
                  !isFullTapePlaying &&
                  filteredTapeFrames.length &&
                  (filteredPosition < 0 || filteredPosition >= filteredTapeFrames.length - 1)
                ) {
                  setFullTapeCursor(filteredTapeFrames[0].index);
                }
                setIsFullTapePlaying((playing) => !playing);
              }}
              type="button"
            >
              {isFullTapePlaying ? "Pause" : "Play 30 FPS"}
            </button>
            <input
              aria-label="Scrub full movement tape"
              max={Math.max(filteredTapeFrames.length - 1, 0)}
              min="0"
              onChange={(event) => {
                setIsFullTapePlaying(false);
                const selectedFrame = filteredTapeFrames[Number(event.target.value)];
                if (selectedFrame) setFullTapeCursor(selectedFrame.index);
              }}
              step="1"
              type="range"
              value={filteredTapeCursorPosition}
            />
            <button
              aria-label="Next frame"
              onClick={() => {
                setIsFullTapePlaying(false);
                const position = filteredTapeFrames.findIndex(
                  (entry) => entry.index === fullTapeCursor
                );
                const next = filteredTapeFrames[
                  Math.min(filteredTapeFrames.length - 1, Math.max(0, position + 1))
                ];
                if (next) setFullTapeCursor(next.index);
              }}
              type="button"
            >
              +1f
            </button>
            <span>{filteredTapeCursorPosition + 1}/{filteredTapeFrames.length}</span>
          </div>

          <div className="practice-camera-roll-heading">
            <div>
              <p className="eyebrow">All frames</p>
              <strong>Skeleton camera roll · click any frame to analyze</strong>
              <div className="practice-camera-roll-filters">
                <label>
                  <span>Count</span>
                  <select
                    onChange={(event) => {
                      const nextFilter = event.target.value;
                      setAnalysisCountFilter(nextFilter);
                      const matchIndex = fullTapeFrames.findIndex(
                        (frame) =>
                          (nextFilter === "all" || frame.rep === Number(nextFilter)) &&
                          (analysisStepFilter === "all" || frame.step === Number(analysisStepFilter))
                      );
                      if (matchIndex >= 0) setFullTapeCursor(matchIndex);
                    }}
                    value={analysisCountFilter}
                  >
                    <option value="all">All counts</option>
                    {popupRepTape.map((rep) => (
                      <option key={`count-filter-${rep.rep}`} value={rep.rep}>
                        Count {rep.rep}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Step</span>
                  <select
                    onChange={(event) => {
                      const nextFilter = event.target.value;
                      setAnalysisStepFilter(nextFilter);
                      const matchIndex = fullTapeFrames.findIndex(
                        (frame) =>
                          (analysisCountFilter === "all" || frame.rep === Number(analysisCountFilter)) &&
                          (nextFilter === "all" || frame.step === Number(nextFilter))
                      );
                      if (matchIndex >= 0) setFullTapeCursor(matchIndex);
                    }}
                    value={analysisStepFilter}
                  >
                    <option value="all">All steps</option>
                    {tapeAnalysisSteps.map((step, index) => (
                      <option key={`step-filter-${step.id ?? index}`} value={index + 1}>
                        Step {index + 1} · {step.step_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="practice-camera-roll-tools">
              <span>{filteredTapeFrames.length}/{fullTapeFrames.length} frames</span>
              <button
                aria-label="Compress timeline"
                disabled={cameraRollZoom <= .75}
                onClick={() =>
                  setCameraRollZoom((zoom) =>
                    Math.max(.75, Math.round((zoom / 1.5) * 100) / 100)
                  )
                }
                type="button"
              >
                −
              </button>
              <span>{timelineFrameWidth < 10 ? timelineFrameWidth.toFixed(2) : Math.round(timelineFrameWidth)} px/frame</span>
              <button
                aria-label="Expand timeline"
                disabled={cameraRollZoom >= 120}
                onClick={() =>
                  setCameraRollZoom((zoom) =>
                    Math.min(120, Math.round(zoom * 1.5 * 100) / 100)
                  )
                }
                type="button"
              >
                +
              </button>
              <button
                onClick={() => setIsCameraRollExpanded((expanded) => !expanded)}
                type="button"
              >
                {isCameraRollExpanded ? "Compact sequence + chart" : "Expand sequence + chart"}
              </button>
            </div>
          </div>

          <div
            aria-label="All skeleton frames"
            className={`practice-camera-roll ${isCameraRollExpanded ? "is-expanded" : ""} ${timelineFrameWidth < 24 ? "is-compressed" : ""}`}
            onScroll={(event) =>
              syncTimelineScroll(event.currentTarget, accuracyTimelineScrollRef)
            }
            ref={cameraRollScrollRef}
            style={{
              "--camera-roll-frame-width": `${timelineFrameWidth}px`,
              "--timeline-content-width": `${timelineContentWidth}px`
            }}
          >
            {fullTapeFrames.map((frame, index) => {
              const matchesFilter =
                (analysisCountFilter === "all" ||
                  frame.rep === Number(analysisCountFilter)) &&
                (analysisStepFilter === "all" ||
                  frame.step === Number(analysisStepFilter));
              return (
                <button
                  aria-label={`Frame ${frame.frame}, count ${frame.rep}, step ${frame.step}, ${frame.accuracy}% accuracy`}
                  className={`${index === fullTapeCursor ? "is-current" : ""} ${frame.accuracy < CLEAN_ACCURACY ? "is-review" : "is-clean"} ${matchesFilter ? "is-filter-match" : "is-filtered-out"}`}
                  disabled={!matchesFilter}
                  key={frame.frame}
                  onClick={() => {
                    setIsFullTapePlaying(false);
                    setFullTapeCursor(index);
                  }}
                  type="button"
                >
                  <TapeSkeleton
                    highlightBodyPart={
                      frame.accuracy < CLEAN_ACCURACY ? frame.focusBodyPart : null
                    }
                    highlightBodyParts={
                      frame.accuracy < CLEAN_ACCURACY ? frame.wrongBodyParts : []
                    }
                    landmarks={frame.landmarks}
                    mirrored={displayMirrored}
                  />
                  <span className="practice-camera-roll__frame">F{frame.frame}</span>
                  <time>{formatTapeTime(frame.elapsedMs)}</time>
                  <span>C{frame.rep} · S{frame.step} · {frame.attentionTiming === "on-time" ? "ON" : frame.attentionTiming?.toUpperCase()}</span>
                  <strong>{frame.accuracy}%</strong>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {historySessionPopup ? (
        <section
          aria-label={`${historySessionPopup.technique_name} session analysis`}
          aria-modal="true"
          className="practice-history-popup"
          role="dialog"
        >
          <div className="practice-history-popup__header">
            <div>
              <p className="eyebrow">Saved session</p>
              <h2>{historySessionPopup.technique_name}</h2>
              <time dateTime={historySessionPopup.ended_at || historySessionPopup.started_at || undefined}>
                {formatSessionTimestamp(
                  historySessionPopup.ended_at || historySessionPopup.started_at
                )}
              </time>
            </div>
            <button onClick={() => setHistorySessionPopup(null)} type="button">
              Close
            </button>
          </div>
          <div className="practice-history-popup__metrics">
            <span><small>Average form</small><strong>{historySessionPopup.average_accuracy}%</strong></span>
            <span><small>Best form</small><strong>{historySessionPopup.best_accuracy}%</strong></span>
            <span><small>Repetitions</small><strong>{historySessionPopup.completed_reps}/{historySessionPopup.target_reps}</strong></span>
            <span><small>Clean reps</small><strong>{historySessionPopup.clean_reps}</strong></span>
            <span><small>Consistency</small><strong>{historySessionPopup.consistency_score}%</strong></span>
            <span><small>Average pace</small><strong>{historySessionPopup.average_rep_seconds}s</strong></span>
            <span><small>Started</small><strong>{formatSessionTimestamp(historySessionPopup.started_at)}</strong></span>
            <span><small>Finished</small><strong>{formatSessionTimestamp(historySessionPopup.ended_at)}</strong></span>
          </div>
          <div className="practice-history-popup__notice">
            <span>Frame tape availability</span>
            <strong>
              The detailed 30 FPS skeleton tape is available for the current completed set.
              Older saved sessions currently contain summary metrics only.
            </strong>
          </div>
        </section>
      ) : null}
    </>
  );
}
