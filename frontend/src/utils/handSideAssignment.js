const MIN_POSE_VISIBILITY = 0.45;

const SIDE_LANDMARKS = {
  left: { wrist: 15, elbow: 13, shoulder: 11 },
  right: { wrist: 16, elbow: 14, shoulder: 12 }
};

function distance(first, second) {
  return Math.hypot(
    first.x - second.x,
    first.y - second.y,
    (first.z || 0) - (second.z || 0)
  );
}

function isReliable(point) {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (point.visibility == null || point.visibility >= MIN_POSE_VISIBILITY)
  );
}

function getPoseAnchor(poseLandmarks, side) {
  const indices = SIDE_LANDMARKS[side];
  const candidates = [
    { point: poseLandmarks?.[indices.wrist], penalty: 0 },
    { point: poseLandmarks?.[indices.elbow], penalty: 0.07 },
    { point: poseLandmarks?.[indices.shoulder], penalty: 0.14 }
  ];

  return candidates.find(({ point }) => isReliable(point)) || null;
}

function getModelSide(handedness = []) {
  const category = handedness?.[0];
  const label = category?.categoryName?.toLowerCase?.();

  if (label !== "left" && label !== "right") return null;

  return {
    side: label,
    score: Number.isFinite(category.score) ? category.score : 0.5
  };
}

function getSideCost(hand, poseLandmarks, handedness, side) {
  const handWrist = hand?.[0];
  const anchor = getPoseAnchor(poseLandmarks, side);
  const modelSide = getModelSide(handedness);
  let cost = anchor && handWrist ? distance(handWrist, anchor.point) + anchor.penalty : 0.35;

  // Handedness is useful when Pose is incomplete, but body landmarks remain
  // authoritative because an unmirrored camera feed can invert classifier labels.
  if (modelSide) {
    const modelPenalty = modelSide.side === side ? 0 : 0.08 * modelSide.score;
    cost += anchor ? modelPenalty : modelSide.side === side ? 0 : 0.3 * modelSide.score;
  }

  return cost;
}

export function assignHandSides(handLandmarksList = [], poseLandmarks = [], handednessList = []) {
  const hands = (Array.isArray(handLandmarksList) ? handLandmarksList : [])
    .filter((hand) => hand?.[0]);

  if (!hands.length) return [];

  const scoredHands = hands.map((hand, index) => {
    const costs = {
      left: getSideCost(hand, poseLandmarks, handednessList?.[index], "left"),
      right: getSideCost(hand, poseLandmarks, handednessList?.[index], "right")
    };

    return { hand, costs };
  });

  if (scoredHands.length === 1) {
    const entry = scoredHands[0];
    const side = entry.costs.left <= entry.costs.right ? "left" : "right";

    return [{
      hand: entry.hand,
      side,
      confidence: Math.abs(entry.costs.left - entry.costs.right)
    }];
  }

  const [first, second] = scoredHands;
  const leftRightCost = first.costs.left + second.costs.right;
  const rightLeftCost = first.costs.right + second.costs.left;
  const assignments = leftRightCost <= rightLeftCost
    ? ["left", "right"]
    : ["right", "left"];

  return scoredHands.slice(0, 2).map((entry, index) => ({
    hand: entry.hand,
    side: assignments[index],
    confidence: Math.abs(entry.costs.left - entry.costs.right)
  }));
}
