const IMAGE_PLANE_PARTS = /^(elbow|wrist)_(left|right)$/;

export function isImagePlaneAnglePart(bodyPart) {
  return IMAGE_PLANE_PARTS.test(bodyPart);
}

export function selectAngleLandmarks(bodyPart, imagePose, worldPose) {
  // Monocular world-depth estimates can make a visibly straight arm appear
  // bent by 20-35 degrees. Arm flexion coaching should agree with the camera
  // overlay, so elbows and the pose-based wrist proxy use image coordinates.
  if (isImagePlaneAnglePart(bodyPart) && imagePose?.length) {
    return imagePose;
  }

  return worldPose?.length ? worldPose : imagePose;
}
