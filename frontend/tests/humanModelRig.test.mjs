import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PropertyBinding, Vector3 } from "three";
import {
  HUMAN_MODEL_RIG,
  FIST_BEND_ANGLES,
  MODEL_SIDE_FOR_POSE_SIDE,
  MODEL_FIST_BEND_ANGLES,
  MODEL_FIST_THUMB_ANGLES,
  THUMB_BEND_ANGLES,
  aimModelBone,
  buildHandLandmarks,
  effectiveFingerSpread,
  handSegmentDirection,
  levelFootTarget,
  modelClosedFistDirections,
  retargetModelHand,
  stabilizedHeadTarget,
} from "../src/skeleton/humanModelRig.js";

function glbJson(path) {
  const bytes = fs.readFileSync(path);
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(
        bytes.subarray(offset + 8, offset + 8 + length).toString("utf8").replace(/\0+$/, ""),
      );
    }
    offset += 8 + length;
  }
  throw new Error("GLB JSON chunk was not found");
}

test("manual pose model rig resolves every required bone in the shipped GLB", () => {
  const document = glbJson(new URL("../public/models/human/ch36-rigged.glb", import.meta.url));
  const boneNames = new Set(
    document.nodes
      .map((node) => node.name)
      .filter(Boolean)
      .map((name) => PropertyBinding.sanitizeNodeName(name)),
  );
  const missing = Object.values(HUMAN_MODEL_RIG).filter((name) => !boneNames.has(name));

  assert.deepEqual(missing, []);
});

test("manual pose model rig deforms a loaded limb toward the authored skeleton", async () => {
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const bytes = fs.readFileSync(
    new URL("../public/models/human/ch36-rigged.glb", import.meta.url),
  );
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject),
  );
  gltf.scene.updateMatrixWorld(true);

  const modelRightArm = gltf.scene
    .getObjectByName(HUMAN_MODEL_RIG.rightArm)
    .getWorldPosition(new Vector3());
  const modelLeftArm = gltf.scene
    .getObjectByName(HUMAN_MODEL_RIG.leftArm)
    .getWorldPosition(new Vector3());
  assert.equal(MODEL_SIDE_FOR_POSE_SIDE.left, "right");
  assert.ok(modelRightArm.x < modelLeftArm.x);

  assert.equal(
    aimModelBone(
      gltf.scene,
      HUMAN_MODEL_RIG.leftArm,
      HUMAN_MODEL_RIG.leftElbow,
      [0, 0, 0],
      [0, -1, 0],
    ),
    true,
  );
  const arm = gltf.scene.getObjectByName(HUMAN_MODEL_RIG.leftArm);
  const elbow = gltf.scene.getObjectByName(HUMAN_MODEL_RIG.leftElbow);
  const direction = elbow
    .getWorldPosition(new Vector3())
    .sub(arm.getWorldPosition(new Vector3()))
    .normalize();

  assert.ok(direction.dot(new Vector3(0, -1, 0)) > 0.999);

  const pose = {
    head: [0, 1.65, 0],
    shoulder_left: [-0.52, 1.15, 0],
    shoulder_right: [0.52, 1.15, 0],
    elbow_left: [-0.84, 0.67, 0.02],
    elbow_right: [0.84, 0.67, 0.02],
    wrist_left: [-0.62, 0.18, 0.05],
    wrist_right: [0.62, 0.18, 0.05],
  };
  const articulation = {
    hand_left: { fist_closure: 1, finger_spread: 1, wrist_rotation: [0, 0, 0] },
    hand_right: { fist_closure: 0, finger_spread: 0.35, wrist_rotation: [0, 0, 0] },
  };
  const leftHandPoints = buildHandLandmarks(pose, articulation, "left");
  assert.equal(leftHandPoints.length, 21);
  assert.equal(retargetModelHand(gltf.scene, "right", leftHandPoints), 15);

  const chains = [
    ["Index", 5],
    ["Middle", 9],
    ["Ring", 13],
    ["Pinky", 17],
    ["Thumb", 1],
  ];
  for (const [finger, base] of chains) {
    for (let segment = 0; segment < 3; segment += 1) {
      const bone = gltf.scene.getObjectByName(
        `mixamorig1RightHand${finger}${segment + 1}`,
      );
      const child = gltf.scene.getObjectByName(
        `mixamorig1RightHand${finger}${segment + 2}`,
      );
      const modelDirection = child
        .getWorldPosition(new Vector3())
        .sub(bone.getWorldPosition(new Vector3()))
        .normalize();
      const pointDirection = new Vector3(...leftHandPoints[base + segment + 1])
        .sub(new Vector3(...leftHandPoints[base + segment]))
        .normalize();
      assert.ok(
        modelDirection.dot(pointDirection) > 0.999,
        `${finger} segment ${segment + 1} must follow its exact landmark pair`,
      );
    }
  }

  const preset = modelClosedFistDirections(leftHandPoints, "right");
  assert.equal(retargetModelHand(gltf.scene, "right", leftHandPoints, 1), 15);
  for (const [finger] of chains) {
    const expected = finger === "Thumb" ? preset.thumb : preset.fingers;
    for (let segment = 0; segment < 3; segment += 1) {
      const bone = gltf.scene.getObjectByName(
        `mixamorig1RightHand${finger}${segment + 1}`,
      );
      const child = gltf.scene.getObjectByName(
        `mixamorig1RightHand${finger}${segment + 2}`,
      );
      const direction = child
        .getWorldPosition(new Vector3())
        .sub(bone.getWorldPosition(new Vector3()))
        .normalize();
      assert.ok(
        direction.dot(new Vector3(...expected[segment])) > 0.999,
        `${finger} segment ${segment + 1} must use the 100% fist preset`,
      );
    }
  }
});

test("model hand targeting considers knuckle and thumb-base landmarks", () => {
  const landmarks = Array.from({ length: 21 }, () => [0, 0, 0]);
  landmarks[0] = [0, 0, 0];
  for (const base of [5, 9, 13, 17]) {
    landmarks[base] = [0, 1, 0];
    landmarks[base + 1] = [0, 2, 0];
    landmarks[base + 2] = [0, 3, 0];
    landmarks[base + 3] = [0, 4, 0];
  }
  landmarks[5] = [-1, 1, 0];
  landmarks[6] = [-1, 2, 0];
  landmarks[7] = [-1, 3, 0];
  landmarks[8] = [-1, 4, 0];
  landmarks[1] = [1, 0, 0];
  landmarks[2] = [1, 1, 0];
  landmarks[3] = [1, 2, 0];
  landmarks[4] = [1, 3, 0];

  assert.deepEqual(handSegmentDirection(landmarks, 5, 0), [0, 1, 0]);
  assert.deepEqual(handSegmentDirection(landmarks, 5, 2), [0, 1, 0]);
});

test("fully open hand landmarks form straight separated finger lines", () => {
  const pose = {
    head: [0, 1.65, 0],
    shoulder_left: [-0.52, 1.15, 0],
    shoulder_right: [0.52, 1.15, 0],
    elbow_left: [-0.84, 0.67, 0.02],
    wrist_left: [-0.62, 0.18, 0.05],
  };
  const articulation = {
    hand_left: { fist_closure: 0, finger_spread: 1, wrist_rotation: [0, 0, 0] },
  };
  const points = buildHandLandmarks(pose, articulation, "left");
  const bases = [5, 9, 13, 17];
  const basePositions = bases.map((base) => new Vector3(...points[base]));

  for (const base of bases) {
    const first = new Vector3(...points[base + 1]).sub(new Vector3(...points[base])).normalize();
    const second = new Vector3(...points[base + 2]).sub(new Vector3(...points[base + 1])).normalize();
    const third = new Vector3(...points[base + 3]).sub(new Vector3(...points[base + 2])).normalize();
    assert.ok(first.dot(second) > 0.999);
    assert.ok(second.dot(third) > 0.999);
  }
  assert.ok(basePositions[0].distanceTo(basePositions[3]) > 0.15);
  const thumbBase = new Vector3(...points[1]).sub(new Vector3(...points[0])).normalize();
  const thumbMiddle = new Vector3(...points[2]).sub(new Vector3(...points[1])).normalize();
  const thumbTip = new Vector3(...points[4]).sub(new Vector3(...points[3])).normalize();
  const indexDirection = new Vector3(...points[6]).sub(new Vector3(...points[5])).normalize();
  assert.ok(thumbBase.dot(thumbMiddle) > 0.999);
  assert.ok(thumbMiddle.dot(thumbTip) > 0.999);
  const thumbIndexAlignment = thumbMiddle.dot(indexDirection);
  assert.ok(thumbIndexAlignment > 0.6);
  assert.ok(thumbIndexAlignment < 0.8);
  assert.ok(new Vector3(...points[4]).distanceTo(new Vector3(...points[0])) < 0.18);
});

test("open thumbs are mirrored toward the body centre", () => {
  const pose = {
    head: [0, 1.65, 0],
    shoulder_left: [-0.52, 1.15, 0],
    shoulder_right: [0.52, 1.15, 0],
    elbow_left: [-0.84, 0.67, 0.02],
    elbow_right: [0.84, 0.67, 0.02],
    wrist_left: [-0.62, 0.18, 0.05],
    wrist_right: [0.62, 0.18, 0.05],
  };
  const articulation = {
    hand_left: { fist_closure: 0, finger_spread: 1, wrist_rotation: [0, 0, 0] },
    hand_right: { fist_closure: 0, finger_spread: 1, wrist_rotation: [0, 0, 0] },
  };
  const left = buildHandLandmarks(pose, articulation, "left");
  const right = buildHandLandmarks(pose, articulation, "right");

  assert.ok(left[4][0] > left[0][0]);
  assert.ok(right[4][0] < right[0][0]);
});

test("closed thumbs use the same three-segment curl as the fingers", () => {
  const pose = {
    head: [0, 1.65, 0],
    shoulder_left: [-0.52, 1.15, 0],
    shoulder_right: [0.52, 1.15, 0],
    elbow_left: [-0.84, 0.67, 0.02],
    elbow_right: [0.84, 0.67, 0.02],
    wrist_left: [-0.62, 0.18, 0.05],
    wrist_right: [0.62, 0.18, 0.05],
  };
  const articulation = {
    hand_left: { fist_closure: 1, finger_spread: 0.35, wrist_rotation: [0, 0, 0] },
    hand_right: { fist_closure: 1, finger_spread: 0.35, wrist_rotation: [0, 0, 0] },
  };
  const openArticulation = {
    hand_left: { fist_closure: 0, finger_spread: 1, wrist_rotation: [0, 0, 0] },
    hand_right: { fist_closure: 0, finger_spread: 1, wrist_rotation: [0, 0, 0] },
  };
  const left = buildHandLandmarks(pose, articulation, "left");
  const right = buildHandLandmarks(pose, articulation, "right");
  const openLeft = buildHandLandmarks(pose, openArticulation, "left");
  const openRight = buildHandLandmarks(pose, openArticulation, "right");
  for (const points of [left, right]) {
    const first = new Vector3(...points[2]).sub(new Vector3(...points[1])).normalize();
    const middle = new Vector3(...points[3]).sub(new Vector3(...points[2])).normalize();
    const last = new Vector3(...points[4]).sub(new Vector3(...points[3])).normalize();
    assert.ok(first.dot(middle) > 0.5);
    assert.ok(middle.dot(last) > 0.5);
    const thumbReach = new Vector3(...points[4]).distanceTo(
      new Vector3(...points[0]),
    );
    assert.ok(thumbReach > 0.08);
    assert.ok(thumbReach < 0.16);
  }
  const meanTipDepth = (points) =>
    [8, 12, 16, 20].reduce((sum, index) => sum + points[index][2], 0) / 4;
  assert.ok(meanTipDepth(left) < meanTipDepth(openLeft));
  assert.ok(meanTipDepth(right) < meanTipDepth(openRight));
});

test("terminal body-part targets use stable region-specific rotations", () => {
  const shoulders = [0, 1, 0.05];
  const head = [0, 1.45, 0.35];
  const stabilizedHead = stabilizedHeadTarget(shoulders, head);
  assert.equal(stabilizedHead[1], head[1]);
  assert.ok(Math.abs(stabilizedHead[2] - shoulders[2]) < Math.abs(head[2] - shoulders[2]));

  const ankle = [-0.4, -1.5, 0.35];
  const foot = [-0.42, -1.62, 0.7];
  const leveledFoot = levelFootTarget(ankle, foot);
  assert.equal(leveledFoot[0], foot[0]);
  assert.equal(leveledFoot[1], foot[1]);
  assert.equal(leveledFoot[2], foot[2]);

  const extremeFoot = levelFootTarget(ankle, [-0.42, -3, 0.7]);
  assert.ok(extremeFoot[1] > -1.7);
});

test("foot rig includes the final toe endpoint on both sides", () => {
  assert.equal(HUMAN_MODEL_RIG.leftToeEnd, "mixamorig1LeftToe_End");
  assert.equal(HUMAN_MODEL_RIG.rightToeEnd, "mixamorig1RightToe_End");
});

test("closed fists converge spread and curl all three finger segments", () => {
  assert.ok(effectiveFingerSpread(1, 1) < effectiveFingerSpread(1, 0));
  assert.ok(effectiveFingerSpread(1, 1) < 0.5);
  assert.deepEqual(FIST_BEND_ANGLES, [75, 145, 190]);
  assert.deepEqual(THUMB_BEND_ANGLES, [45, 95, 135]);
  assert.deepEqual(MODEL_FIST_BEND_ANGLES, [70, 140, 180]);
  assert.deepEqual(MODEL_FIST_THUMB_ANGLES, [35, 75, 115]);
  const adjacentDirectionsStayForward = (angles) =>
    angles.slice(1).every((angle, index) => angle - angles[index] < 90);
  assert.ok(adjacentDirectionsStayForward(MODEL_FIST_BEND_ANGLES));
  assert.ok(adjacentDirectionsStayForward(MODEL_FIST_THUMB_ANGLES));
});
