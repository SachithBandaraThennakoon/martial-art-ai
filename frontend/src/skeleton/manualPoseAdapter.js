import * as THREE from "three";

const DIRECT_MAPPING = {
  11: "shoulder_left", 12: "shoulder_right", 13: "elbow_left", 14: "elbow_right",
  15: "wrist_left", 16: "wrist_right", 23: "hip_left", 24: "hip_right",
  25: "knee_left", 26: "knee_right", 27: "ankle_left", 28: "ankle_right",
  31: "foot_left", 32: "foot_right",
};

function point(position, source = "authoring") {
  return { x: position[0], y: position[1], z: position[2], visibility: 1, source };
}

function array(vector) {
  return vector.toArray();
}

// This adapter is only a visual preview for the manual 15-point authoring rig.
// Generated face/hand/heel points are explicitly tagged derived_preview and must
// never be stored or treated as MediaPipe measurements.
export function manualPoseToMediaPipePreview(pose) {
  const landmarks = Array(33).fill(null);
  Object.entries(DIRECT_MAPPING).forEach(([id, name]) => {
    if (pose[name]) landmarks[Number(id)] = point(pose[name]);
  });

  const leftShoulder = new THREE.Vector3(...pose.shoulder_left);
  const rightShoulder = new THREE.Vector3(...pose.shoulder_right);
  const head = new THREE.Vector3(...pose.head);
  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const right = rightShoulder.clone().sub(leftShoulder).normalize();
  const up = head.clone().sub(shoulderCenter).normalize();
  const forward = right.clone().cross(up).normalize();
  const facial = (horizontal, vertical, depth = 0.055) => point(array(
    head.clone()
      .add(right.clone().multiplyScalar(horizontal))
      .add(up.clone().multiplyScalar(vertical))
      .add(forward.clone().multiplyScalar(depth)),
  ), "derived_preview");
  landmarks[0] = facial(0, 0.01, 0.075);
  landmarks[1] = facial(-0.035, 0.045); landmarks[2] = facial(-0.055, 0.045);
  landmarks[3] = facial(-0.078, 0.042); landmarks[4] = facial(0.035, 0.045);
  landmarks[5] = facial(0.055, 0.045); landmarks[6] = facial(0.078, 0.042);
  landmarks[7] = facial(-0.135, 0.035, 0); landmarks[8] = facial(0.135, 0.035, 0);
  landmarks[9] = facial(-0.045, -0.07); landmarks[10] = facial(0.045, -0.07);

  ["left", "right"].forEach((side) => {
    const wristId = side === "left" ? 15 : 16;
    const elbow = new THREE.Vector3(...pose[`elbow_${side}`]);
    const wrist = new THREE.Vector3(...pose[`wrist_${side}`]);
    const direction = wrist.clone().sub(elbow).normalize();
    const lateral = forward.clone().cross(direction).normalize();
    const sign = side === "left" ? -1 : 1;
    const handPoint = (reach, width) => point(array(
      wrist.clone().add(direction.clone().multiplyScalar(reach))
        .add(lateral.clone().multiplyScalar(width * sign)),
    ), "derived_preview");
    landmarks[wristId + 2] = handPoint(0.12, 0.045); // pinky
    landmarks[wristId + 4] = handPoint(0.145, -0.01); // index
    landmarks[wristId + 6] = handPoint(0.075, -0.07); // thumb
  });

  ["left", "right"].forEach((side) => {
    const ankleId = side === "left" ? 27 : 28;
    const heelId = side === "left" ? 29 : 30;
    const ankle = new THREE.Vector3(...pose[`ankle_${side}`]);
    const toe = new THREE.Vector3(...pose[`foot_${side}`]);
    const direction = toe.clone().sub(ankle).normalize();
    landmarks[heelId] = point(array(ankle.clone().add(direction.multiplyScalar(-0.1))), "derived_preview");
    landmarks[ankleId] = point(pose[`ankle_${side}`]);
  });
  return landmarks;
}
