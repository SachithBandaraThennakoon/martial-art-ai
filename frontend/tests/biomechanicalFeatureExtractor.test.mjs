import assert from "node:assert/strict";
import test from "node:test";

import { BiomechanicalFeatureExtractor } from "../src/tracking/biomechanicalFeatureExtractor.js";

function point(index, x, y, z = 0) {
  return { index, x, y, z, confidence: 0.98 };
}

function frame(timestampMs, {
  auxiliaryFeatures = {},
  leftWristX = -0.8,
  rightAnkleX = 0.3,
  leftElbowAngle = 90,
  rightKneeAngle = 170
} = {}) {
  const landmarks = [
    point(11, -0.5, -1.5),
    point(12, 0.5, -1.5),
    point(13, -0.65, -1.1),
    point(14, 0.65, -1.1),
    point(15, leftWristX, -1.3),
    point(16, 0.8, -1.3),
    point(23, -0.35, 0),
    point(24, 0.35, 0),
    point(25, -0.35, 0.8),
    point(26, 0.35, 0.8),
    point(27, -0.35, 1.7),
    point(28, rightAnkleX, 1.7)
  ];
  const velocity = Object.fromEntries(
    landmarks.map(({ index }) => [index, { x: 0, y: 0, z: 0 }])
  );

  return {
    timestamp: timestampMs / 1000,
    tracking: { confidence: 0.97 },
    motion_context: {
      normalized_landmarks: landmarks,
      angles_deg: {
        elbow_left: leftElbowAngle,
        elbow_right: 90,
        hip_right: 170,
        knee_right: rightKneeAngle
      },
      auxiliary_features: auxiliaryFeatures,
      velocity
    }
  };
}

test("feature extraction reports camera-scale-normalized Jab motion", () => {
  const extractor = new BiomechanicalFeatureExtractor();
  extractor.update(frame(0), { leadSide: "left" });
  const extended = extractor.update(
    frame(100, { leftWristX: -1.2, leftElbowAngle: 140 }),
    { leadSide: "left" }
  );

  assert.equal(extended.features.lead_elbow_angle, 140);
  assert.ok(extended.features.lead_elbow_angular_velocity > 0);
  assert.ok(extended.features.lead_wrist_forward_velocity > 0);
  assert.equal(extended.trackingConfidence, 0.97);
});

test("feature extraction distinguishes kick extension and recoil velocities", () => {
  const extractor = new BiomechanicalFeatureExtractor();
  extractor.update(frame(0), { kickSide: "right" });
  const extension = extractor.update(
    frame(100, { rightAnkleX: 0.9, rightKneeAngle: 150 }),
    { kickSide: "right" }
  );
  const recoil = extractor.update(
    frame(200, { rightAnkleX: 0.45, rightKneeAngle: 90 }),
    { kickSide: "right" }
  );

  assert.ok(extension.features.kick_foot_forward_velocity > 0);
  assert.ok(recoil.features.kick_foot_forward_velocity < 0);
  assert.ok(recoil.features.kick_knee_angular_velocity < 0);
});

test("feature extraction exposes optional hand and face evidence by anatomical side", () => {
  const extractor = new BiomechanicalFeatureExtractor();
  const extracted = extractor.update(
    frame(0, {
      auxiliaryFeatures: {
        fist_left: 82,
        fist_right: 64,
        face_forward: 91,
        eyes_forward: 88,
        face_calm: 73
      }
    }),
    { leadSide: "right" }
  );

  assert.equal(extracted.features.lead_fist_closure_score, 64);
  assert.equal(extracted.features.rear_fist_closure_score, 82);
  assert.equal(extracted.features.face_forward_score, 91);
  assert.equal(extracted.features.eyes_forward_score, 88);
  assert.equal(extracted.features.face_calm_score, 73);
});

test("missing optional hand and face evidence remains explicitly unavailable", () => {
  const extractor = new BiomechanicalFeatureExtractor();
  const extracted = extractor.update(frame(0), { leadSide: "left" });

  assert.equal(extracted.features.lead_fist_closure_score, null);
  assert.equal(extracted.features.rear_fist_closure_score, null);
  assert.equal(extracted.features.face_forward_score, null);
});
