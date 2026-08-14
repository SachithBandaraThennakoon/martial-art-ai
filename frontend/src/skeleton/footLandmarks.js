import * as THREE from "three";

function point(vector) {
  return vector.toArray().map((value) => Number(value.toFixed(4)));
}

export function buildFootLandmarks(
  pose,
  side,
  { ballOfFootProgress, strikingSurface = "" } = {},
) {
  const ankle = new THREE.Vector3(...pose[`ankle_${side}`]);
  const footEndpoint = new THREE.Vector3(...pose[`foot_${side}`]);
  const knee = new THREE.Vector3(...pose[`knee_${side}`]);
  const forward = footEndpoint.clone().sub(ankle);
  const length = Math.max(0.2, forward.length());
  forward.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  let lateral = new THREE.Vector3().crossVectors(up, forward);
  if (lateral.lengthSq() < 0.001)
    lateral.set(side === "left" ? -1 : 1, 0, 0);
  lateral.normalize();
  if (side === "left") lateral.multiplyScalar(-1);
  let dorsal = knee.clone().sub(ankle);
  dorsal.addScaledVector(forward, -dorsal.dot(forward));
  if (dorsal.lengthSq() < 0.001) dorsal.copy(up);
  dorsal.normalize();

  const heel = ankle.clone().addScaledVector(forward, -length * 0.22);
  const mid = ankle.clone().lerp(footEndpoint, 0.5);
  const retraction = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(ballOfFootProgress)
        ? ballOfFootProgress
        : strikingSurface === "ball_of_foot" ? 1 : 0,
    ),
  );
  const neutralBall = ankle.clone().lerp(footEndpoint, 0.82);
  const contactBall = footEndpoint.clone();
  const ball = neutralBall.clone().lerp(contactBall, retraction);
  const heelWidth = length * 0.1;
  const midWidth = length * 0.16;
  const ballWidth = length * 0.24;
  const innerHeel = heel.clone().addScaledVector(lateral, heelWidth);
  const outerHeel = heel.clone().addScaledVector(lateral, -heelWidth);
  const innerMid = mid.clone().addScaledVector(lateral, midWidth);
  const outerMid = mid.clone().addScaledVector(lateral, -midWidth);
  const innerBall = ball.clone().addScaledVector(lateral, ballWidth);
  const outerBall = ball.clone().addScaledVector(lateral, -ballWidth);
  const toeLengths = [0.24, 0.27, 0.25, 0.21, 0.17];
  const toes = toeLengths.map((toeLength, index) => {
    const across = 1 - index * 0.5;
    const neutralToe = neutralBall
      .clone()
      .addScaledVector(lateral, across * ballWidth)
      .addScaledVector(forward, length * toeLength);
    // Dorsiflex toward the shin so the metatarsal heads become the leading
    // contact plane. Lerp makes chamber → impact → rechamber continuous.
    const contactToe = contactBall
      .clone()
      .addScaledVector(lateral, across * ballWidth)
      .addScaledVector(forward, -length * (0.035 + index * 0.006))
      .addScaledVector(dorsal, length * toeLength * 0.8);
    return point(neutralToe.lerp(contactToe, retraction));
  });

  return {
    ankle: point(ankle),
    heel: point(heel),
    innerHeel: point(innerHeel),
    outerHeel: point(outerHeel),
    mid: point(mid),
    innerMid: point(innerMid),
    outerMid: point(outerMid),
    ball: point(ball),
    innerBall: point(innerBall),
    outerBall: point(outerBall),
    toes,
  };
}
