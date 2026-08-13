import * as THREE from "three";

// A closed finger must finish inside the palm volume. The distal joint turns
// past 180° so the fingertip returns toward the metacarpals instead of ending
// in a shallow hook beyond the wrist.
// The distal segment passes straight only slightly. A larger value (such as
// 250°) makes the fingertip visibly cross through to the back of the hand,
// contradicting the palm side indicated by the thumb.
const FIST_BEND_ANGLES = [72, 176, 220];
const THUMB_BEND_ANGLES = [45, 95, 135];

function effectiveFingerSpread(spread, closure) {
  const safeSpread = Math.max(0, Math.min(1, Number(spread) || 0));
  const safeClosure = Math.max(0, Math.min(1, Number(closure) || 0));
  return 0.35 + safeSpread * (1 - safeClosure * 0.9);
}

function curledSegmentDirection(forward, curlAxis, segment, closure, angles = FIST_BEND_ANGLES) {
  const angle = THREE.MathUtils.degToRad(angles[segment] * closure);
  return forward
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(curlAxis.clone().multiplyScalar(Math.sin(angle)))
    .normalize();
}

export function buildHandLandmarks(pose, articulation, side) {
  const elbow = new THREE.Vector3(...pose[`elbow_${side}`]);
  const wrist = new THREE.Vector3(...pose[`wrist_${side}`]);
  const shoulderLeft = new THREE.Vector3(...pose.shoulder_left);
  const shoulderRight = new THREE.Vector3(...pose.shoulder_right);
  const shoulderCenter = shoulderLeft.clone().add(shoulderRight).multiplyScalar(0.5);
  const head = new THREE.Vector3(...pose.head);
  const neck = shoulderCenter.clone().add(new THREE.Vector3(0, 0.16, 0));
  const bodyRight = shoulderRight.clone().sub(shoulderLeft).normalize();
  const bodyUp = head.clone().sub(neck).normalize();
  const bodyForward = bodyRight.clone().cross(bodyUp).normalize();
  const settings = articulation[`hand_${side}`];
  const closure = Math.max(0, Math.min(1, settings.fist_closure));

  const direction = wrist.clone().sub(elbow).normalize();
  const palmTurn = Math.max(0, Math.min(1, Number(settings.palm_turn) || 0));
  const projectFromForearm = (vector) =>
    vector
      .clone()
      .addScaledVector(direction, -vector.dot(direction))
      .normalize();
  // Guard: the palm side of the fist faces the center line. Strike: pronate
  // toward palm-down while the front knuckles continue along the forearm to
  // the target. Crucially, wrist orientation must never bend the whole hand
  // away from the elbow-to-wrist axis.
  // Build the visible back-of-hand normal. Finger flexion uses its inverse:
  // toward the centerline in guard and toward the floor at impact. Keeping
  // these as opposite vectors fixes left/right finger order and puts the
  // thumb on the anatomically correct outside face.
  let backOfHandNormal = projectFromForearm(wrist.clone().sub(shoulderCenter));
  if (backOfHandNormal.lengthSq() < 0.01)
    backOfHandNormal = projectFromForearm(bodyForward.clone().negate());
  let strikeBackNormal = projectFromForearm(bodyUp);
  if (strikeBackNormal.lengthSq() < 0.01)
    strikeBackNormal = projectFromForearm(bodyForward.clone().negate());
  let palmNormal = backOfHandNormal.lerp(strikeBackNormal, palmTurn).normalize();
  const wristQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...(settings.wrist_rotation || [0, 0, 0]), "XYZ"),
  );
  // Preserve manual fist roll, but remove any component that would point the
  // knuckles away from the forearm/target line. This makes every rotation
  // handle responsive without allowing a disconnected-looking bent hand.
  const manuallyRotatedPalm = palmNormal.applyQuaternion(wristQuaternion);
  manuallyRotatedPalm.addScaledVector(
    direction,
    -manuallyRotatedPalm.dot(direction),
  );
  if (manuallyRotatedPalm.lengthSq() > 0.001)
    palmNormal = manuallyRotatedPalm.normalize();
  let widthAxis = palmNormal.clone().cross(direction).normalize();
  if (widthAxis.lengthSq() < 0.01) widthAxis = bodyRight.clone();
  const depthAxis = direction.clone().cross(widthAxis).normalize();
  const inwardCurlAxis = depthAxis.clone().negate();

  const landmarks = Array(21);
  landmarks[0] = wrist.toArray();
  const spreadScale = effectiveFingerSpread(settings.finger_spread, closure);
  const fingerOffsets = [-0.078, -0.026, 0.026, 0.078];
  const fingerBases = [5, 9, 13, 17];
  const segmentLengths = [0.07, 0.062, 0.052];
  const easedClosure = THREE.MathUtils.smoothstep(closure, 0, 1);

  fingerBases.forEach((baseIndex, fingerIndex) => {
    const lateral = fingerOffsets[fingerIndex] * spreadScale;
    let fingerPoint = wrist
      .clone()
      .add(direction.clone().multiplyScalar(0.065))
      .add(widthAxis.clone().multiplyScalar(lateral));
    landmarks[baseIndex] = fingerPoint.toArray();
    segmentLengths.forEach((length, segmentIndex) => {
      const segmentDirection = curledSegmentDirection(
        direction,
        inwardCurlAxis,
        segmentIndex,
        easedClosure,
      );
      fingerPoint = fingerPoint.clone().add(segmentDirection.multiplyScalar(length));
      landmarks[baseIndex + segmentIndex + 1] = fingerPoint.toArray();
    });
  });

  const thumbSign = side === "left" ? 1 : -1;
  const openThumbDirection = direction.clone().add(widthAxis.clone().multiplyScalar(thumbSign)).normalize();
  const thumbCurlAxis = inwardCurlAxis
    .clone()
    .addScaledVector(openThumbDirection, -inwardCurlAxis.dot(openThumbDirection))
    .normalize();
  if (thumbCurlAxis.lengthSq() < 0.01) thumbCurlAxis.copy(depthAxis);
  const thumbBaseOpen = wrist.clone().add(openThumbDirection.clone().multiplyScalar(0.04));
  const thumbBaseClosed = wrist
    .clone()
    .add(direction.clone().multiplyScalar(0.035))
    .add(widthAxis.clone().multiplyScalar(thumbSign * 0.035));
  let thumbPoint = thumbBaseOpen.clone().lerp(thumbBaseClosed, easedClosure);
  landmarks[1] = thumbPoint.toArray();
  [0.052, 0.045, 0.038].forEach((length, segment) => {
    thumbPoint = thumbPoint.clone().add(
      curledSegmentDirection(
        openThumbDirection,
        thumbCurlAxis,
        segment,
        easedClosure,
        THUMB_BEND_ANGLES,
      ).multiplyScalar(length),
    );
    landmarks[segment + 2] = thumbPoint.toArray();
  });

  // On a closed fist the thumb crosses the index and middle fingers. Blend
  // its last two landmarks onto that lock line so the tip cannot hang below
  // or outside the curled fingers at full closure.
  // The fingers close first, then the thumb settles firmly across them. A
  // bounded ramp gives half-closed fists a recognizable thumb path instead
  // of leaving it splayed until the slider is nearly 100%.
  const thumbLock = THREE.MathUtils.smoothstep(easedClosure, 0.22, 0.78);
  const fingerLockPoint = new THREE.Vector3(...landmarks[7])
    .add(new THREE.Vector3(...landmarks[11]))
    .multiplyScalar(0.5)
    .add(inwardCurlAxis.clone().multiplyScalar(0.008));
  const thumbBase = new THREE.Vector3(...landmarks[1]);
  const lockedThumbMiddle = thumbBase.clone().lerp(
    fingerLockPoint,
    0.36,
  );
  const lockedThumbJoint = thumbBase.clone().lerp(fingerLockPoint, 0.68);
  landmarks[2] = new THREE.Vector3(...landmarks[2])
    .lerp(lockedThumbMiddle, thumbLock)
    .toArray();
  landmarks[3] = new THREE.Vector3(...landmarks[3])
    .lerp(lockedThumbJoint, thumbLock)
    .toArray();
  landmarks[4] = new THREE.Vector3(...landmarks[4])
    .lerp(fingerLockPoint, thumbLock)
    .toArray();
  return landmarks;
}
