import * as THREE from "three";

// GLTFLoader sanitizes Mixamo's `mixamorig1:` namespace by removing the
// colon before assigning Object3D names.
export const mixamoBone = (name) => `mixamorig1${name}`;

export const HUMAN_MODEL_RIG = {
  chest: mixamoBone("Spine2"),
  spine: mixamoBone("Spine"),
  neck: mixamoBone("Neck"),
  head: mixamoBone("Head"),
  leftArm: mixamoBone("LeftArm"),
  leftElbow: mixamoBone("LeftForeArm"),
  leftWrist: mixamoBone("LeftHand"),
  rightArm: mixamoBone("RightArm"),
  rightElbow: mixamoBone("RightForeArm"),
  rightWrist: mixamoBone("RightHand"),
  leftLeg: mixamoBone("LeftUpLeg"),
  leftKnee: mixamoBone("LeftLeg"),
  leftAnkle: mixamoBone("LeftFoot"),
  leftToe: mixamoBone("LeftToeBase"),
  leftToeEnd: mixamoBone("LeftToe_End"),
  rightLeg: mixamoBone("RightUpLeg"),
  rightKnee: mixamoBone("RightLeg"),
  rightAnkle: mixamoBone("RightFoot"),
  rightToe: mixamoBone("RightToeBase"),
  rightToeEnd: mixamoBone("RightToe_End"),
};

// The authoring skeleton uses screen-space side names (left is negative X),
// while the front-facing Mixamo asset uses anatomical sides (its right side
// is negative X). Cross-map sides instead of rotating the whole model away.
export const MODEL_SIDE_FOR_POSE_SIDE = {
  left: "right",
  right: "left",
};

// Absolute directions of the proximal, middle and distal phalanges at a fully
// closed fist. The distal segment continues the curl without reversing into
// the U-shape produced by the former 250-degree endpoint.
export const FIST_BEND_ANGLES = [75, 145, 190];
// The thumb uses the same curl calculation but cannot safely inherit the
// fingers' 180°/250° return arc; that collapses its distal mesh into itself.
export const THUMB_BEND_ANGLES = [45, 95, 135];
// Model-specific full-fist directions. Adjacent bones advance by 70°/40° for
// a compact C-shaped curl; larger jumps produce the circular hooks visible in
// the skinned GLB even when the abstract landmark lines appear plausible.
export const MODEL_FIST_BEND_ANGLES = [70, 140, 180];
export const MODEL_FIST_THUMB_ANGLES = [35, 75, 115];

export function effectiveFingerSpread(spread, closure) {
  const safeSpread = Math.max(0, Math.min(1, Number(spread) || 0));
  const safeClosure = Math.max(0, Math.min(1, Number(closure) || 0));
  // Spread is useful for an open hand, but fingers converge as a fist closes.
  return 0.35 + safeSpread * (1 - safeClosure * 0.9);
}

function curledSegmentDirection(
  forward,
  curlAxis,
  segment,
  closure,
  angles = FIST_BEND_ANGLES,
) {
  const angle = THREE.MathUtils.degToRad(
    angles[segment] * closure,
  );
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
  let widthAxis = bodyForward.clone().cross(direction).normalize();
  if (widthAxis.lengthSq() < 0.01) widthAxis = bodyRight.clone();
  const wristQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...(settings.wrist_rotation || [0, 0, 0]), "XYZ"),
  );
  direction.applyQuaternion(wristQuaternion);
  widthAxis.applyQuaternion(wristQuaternion);
  const depthAxis = direction.clone().cross(widthAxis).normalize();
  // Flexion must go through the palm, not toward the torso or through the
  // visible back of the hand. The palm-inside normal is opposite depthAxis.
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
      fingerPoint = fingerPoint
        .clone()
        .add(segmentDirection.multiplyScalar(length));
      landmarks[baseIndex + segmentIndex + 1] = fingerPoint.toArray();
    });
  });

  // In editor coordinates, the open thumb points toward the body's centre:
  // positive across-axis on the left hand, negative on the right hand.
  const thumbSign = side === "left" ? 1 : -1;
  const openThumbDirection = direction
    .clone()
    .add(widthAxis.clone().multiplyScalar(thumbSign))
    .normalize();
  const thumbCurlAxis = inwardCurlAxis
    .clone()
    .addScaledVector(
      openThumbDirection,
      -inwardCurlAxis.dot(openThumbDirection),
    )
    .normalize();
  if (thumbCurlAxis.lengthSq() < 0.01) thumbCurlAxis.copy(depthAxis);
  const thumbBaseOpen = wrist
    .clone()
    .add(openThumbDirection.clone().multiplyScalar(0.04));
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
  return landmarks;
}

export function aimModelBoneDirection(scene, boneName, childName, desiredDirection) {
  const bone = scene.getObjectByName(boneName);
  const child = scene.getObjectByName(childName);
  const desired = new THREE.Vector3(...desiredDirection).normalize();
  if (!bone?.isBone || !child?.isBone || !desired.lengthSq()) return false;
  const current = child
    .getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const desiredWorldRotation = delta.multiply(
    bone.getWorldQuaternion(new THREE.Quaternion()),
  );
  const parentWorldRotation = bone.parent.getWorldQuaternion(
    new THREE.Quaternion(),
  );
  bone.quaternion.copy(
    parentWorldRotation.invert().multiply(desiredWorldRotation),
  );
  scene.updateMatrixWorld(true);
  return true;
}

export function handSegmentDirection(landmarks, base, segment) {
  const from = new THREE.Vector3(...landmarks[base + segment]);
  const to = new THREE.Vector3(...landmarks[base + segment + 1]);
  // Use the authored point pair exactly. Do not add spread or palm offsets
  // here: doing so silently changes the final 7→8, 11→12, 15→16 and 19→20
  // endpoint directions after the skeleton has already generated them.
  return to.sub(from).normalize().toArray();
}

export function modelClosedFistDirections(landmarks, modelSide) {
  const wrist = new THREE.Vector3(...landmarks[0]);
  const palmForward = [5, 9, 13, 17]
    .map((index) => new THREE.Vector3(...landmarks[index]))
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(0.25)
    .sub(wrist)
    .normalize();
  const authoredFirst = new THREE.Vector3(...landmarks[6])
    .sub(new THREE.Vector3(...landmarks[5]))
    .normalize();
  const authoredFirstAngle = THREE.MathUtils.degToRad(FIST_BEND_ANGLES[0]);
  const curlAxis = authoredFirst
    .clone()
    .addScaledVector(palmForward, -Math.cos(authoredFirstAngle))
    .normalize();
  const across = new THREE.Vector3(...landmarks[17])
    .sub(new THREE.Vector3(...landmarks[5]))
    .normalize();
  // Model sides are anatomical and cross-mapped from editor pose sides.
  const thumbSign = modelSide === "left" ? -1 : 1;
  const thumbForward = palmForward
    .clone()
    .addScaledVector(across, thumbSign)
    .normalize();
  const thumbCurlAxis = curlAxis
    .clone()
    .addScaledVector(thumbForward, -curlAxis.dot(thumbForward))
    .normalize();
  return {
    fingers: MODEL_FIST_BEND_ANGLES.map((angle) =>
      curledSegmentDirection(
        palmForward,
        curlAxis,
        0,
        1,
        [angle],
      ).toArray(),
    ),
    thumb: MODEL_FIST_THUMB_ANGLES.map((angle) =>
      curledSegmentDirection(
        thumbForward,
        thumbCurlAxis,
        0,
        1,
        [angle],
      ).toArray(),
    ),
  };
}

export function retargetModelHand(scene, modelSide, landmarks, closure = 0) {
  const sideName = modelSide === "left" ? "Left" : "Right";
  const fistBlend = THREE.MathUtils.smoothstep(
    Math.max(0, Math.min(1, Number(closure) || 0)),
    0.75,
    1,
  );
  const closedFist = modelClosedFistDirections(landmarks, modelSide);
  const chains = [
    ["Index", 5],
    ["Middle", 9],
    ["Ring", 13],
    ["Pinky", 17],
  ];
  let alignedSegments = 0;
  chains.forEach(([finger, base]) => {
    const bones = [1, 2, 3, 4].map((joint) =>
      mixamoBone(`${sideName}Hand${finger}${joint}`),
    );
    for (let segment = 0; segment < 3; segment += 1) {
      const desired = new THREE.Vector3(
        ...handSegmentDirection(landmarks, base, segment),
      )
        .lerp(new THREE.Vector3(...closedFist.fingers[segment]), fistBlend)
        .normalize()
        .toArray();
      if (aimModelBoneDirection(scene, bones[segment], bones[segment + 1], desired))
        alignedSegments += 1;
    }
  });
  const thumbBones = [1, 2, 3, 4].map((joint) =>
    mixamoBone(`${sideName}HandThumb${joint}`),
  );
  for (let segment = 0; segment < 3; segment += 1) {
    const desired = new THREE.Vector3(...landmarks[segment + 2])
      .sub(new THREE.Vector3(...landmarks[segment + 1]))
      .normalize()
      .lerp(new THREE.Vector3(...closedFist.thumb[segment]), fistBlend)
      .normalize()
      .toArray();
    if (
      aimModelBoneDirection(
        scene,
        thumbBones[segment],
        thumbBones[segment + 1],
        desired,
      )
    )
      alignedSegments += 1;
  }
  return alignedSegments;
}

export function aimModelBone(scene, boneName, childName, from, to) {
  const bone = scene.getObjectByName(boneName);
  const child = scene.getObjectByName(childName);
  if (!bone?.isBone || !child?.isBone) return false;

  const currentDirection = child
    .getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const desiredDirection = new THREE.Vector3(...to)
    .sub(new THREE.Vector3(...from))
    .normalize();
  if (!currentDirection.lengthSq() || !desiredDirection.lengthSq()) return false;

  const delta = new THREE.Quaternion().setFromUnitVectors(
    currentDirection,
    desiredDirection,
  );
  const desiredWorldRotation = delta.multiply(
    bone.getWorldQuaternion(new THREE.Quaternion()),
  );
  const parentWorldRotation = bone.parent.getWorldQuaternion(
    new THREE.Quaternion(),
  );
  bone.quaternion.copy(
    parentWorldRotation.invert().multiply(desiredWorldRotation),
  );
  scene.updateMatrixWorld(true);
  return true;
}

export function stabilizedHeadTarget(shoulderCenter, head) {
  // The authored head point is a position landmark, not a gaze vector. Using
  // its full depth offset as neck pitch makes the model look sharply folded.
  return [
    head[0],
    head[1],
    shoulderCenter[2] + (head[2] - shoulderCenter[2]) * 0.35,
  ];
}

export function levelFootTarget(ankle, foot) {
  // Preserve the authored ankle-to-toe pitch so the model matches the
  // skeleton. Clamp only extreme vertical values that would turn the foot
  // upright or drive it through the floor.
  const horizontalLength = Math.hypot(foot[0] - ankle[0], foot[2] - ankle[2]);
  const maximumDrop = horizontalLength * 0.55;
  const maximumRise = horizontalLength * 0.1;
  const verticalOffset = Math.max(
    -maximumDrop,
    Math.min(maximumRise, foot[1] - ankle[1]),
  );
  return [foot[0], ankle[1] + verticalOffset, foot[2]];
}
