import assert from "node:assert/strict";
import test from "node:test";

import { deriveSceneGeometry } from "../src/perception/sceneGeometryAdapter.js";

const pose = Array.from({ length: 33 }, (_, index) => ({
  x: 0.35 + (index % 2) * 0.3,
  y: 0.2 + index * 0.018,
  z: index * -0.002,
  visibility: 0.9,
}));
const world = pose.map((point) => ({ ...point, x: point.x - 0.5, y: point.y - 0.5 }));

test("derives compact floor, wall, and user geometry without raw media", () => {
  const result = deriveSceneGeometry({ imagePose: pose, worldPose: world, trackingConfidence: 0.92 });

  assert.equal(result.surfaces[0].surface_type, "floor");
  assert.equal(result.surfaces[1].surface_type, "wall");
  assert.equal(result.surfaces[0].boundary.length, 4);
  assert.equal(result.geometry.positions["user:primary"].length, 3);
  assert.equal(result.geometry.ground_plane.length, 4);
  assert.equal(result.diagnostics.raw_media_stored, false);
  assert.ok(result.geometry.confidence > 0.8);
});

test("remains conservative when feet and world landmarks are unavailable", () => {
  const upperBody = pose.map((point, index) => index >= 27 ? { ...point, visibility: 0 } : point);
  const result = deriveSceneGeometry({ imagePose: upperBody, trackingConfidence: 0.4 });

  assert.equal(result.geometry.ground_plane, null);
  assert.equal(result.diagnostics.world_geometry, false);
  assert.ok(result.surfaces[0].confidence < 0.5);
});
