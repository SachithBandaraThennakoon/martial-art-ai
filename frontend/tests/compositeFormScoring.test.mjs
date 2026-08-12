import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCorrectionAcknowledgement,
  buildCompositeCorrectionFeedback,
  buildNaturalAwarenessFeedback,
  scoreCompositeForm
} from "../src/utils/compositeFormScoring.js";

const angleTargets = [
  {
    body_part: "elbow_left",
    label: "Lead elbow",
    target_angle: 150,
    min: 130,
    max: 170,
    role: "primary"
  },
  {
    body_part: "knee_left",
    label: "Front knee",
    target_angle: 125,
    min: 105,
    max: 145,
    role: "supporting"
  }
];

test("composite form score rewards ideal full-body evidence", () => {
  const result = scoreCompositeForm({
    angleTargets,
    liveAngles: { elbow_left: 150, knee_left: 125 },
    liveFeatures: { motion_energy: 0.2 },
    nonAngleTargets: [
      { feature: "motion_energy", label: "Stable motion", operator: "lte", value: 0.4 }
    ]
  });

  assert.equal(result.accuracy, 100);
  assert.equal(result.coverage, 100);
  assert.equal(result.corrections.length, 0);
  assert.equal(result.strengths.length, 2);
  assert.equal(result.strengths[0].bodyPart, "elbow_left");
  assert.equal(result.scorable, true);
});

test("missing supporting evidence reduces coverage instead of becoming zero", () => {
  const result = scoreCompositeForm({
    angleTargets,
    liveAngles: { elbow_left: 150 }
  });

  assert.equal(result.accuracy, 100);
  assert.ok(result.coverage > 35);
  assert.ok(result.coverage < 100);
});

test("difficulty changes tolerance without excluding body corrections", () => {
  const easy = scoreCompositeForm({
    angleTargets,
    difficulty: "easy",
    liveAngles: { elbow_left: 105, knee_left: 170 }
  });
  const hard = scoreCompositeForm({
    angleTargets,
    difficulty: "hard",
    liveAngles: { elbow_left: 105, knee_left: 170 }
  });

  assert.ok(easy.accuracy > hard.accuracy);
  assert.equal(easy.corrections.length, 2);
  assert.equal(hard.corrections.length, 2);
});

test("every configured angle contributes equally unless explicitly weighted", () => {
  const correctPrimaryOnly = scoreCompositeForm({
    angleTargets,
    liveAngles: { elbow_left: 150, knee_left: 175 }
  });
  const correctSupportingOnly = scoreCompositeForm({
    angleTargets,
    liveAngles: { elbow_left: 95, knee_left: 125 }
  });

  assert.equal(correctPrimaryOnly.coverage, 100);
  assert.equal(correctSupportingOnly.coverage, 100);
  assert.equal(
    correctPrimaryOnly.accuracy,
    correctSupportingOnly.accuracy
  );
  assert.deepEqual(
    correctPrimaryOnly.corrections.map((item) => item.bodyPart),
    ["knee_left"]
  );
  assert.deepEqual(
    correctSupportingOnly.corrections.map((item) => item.bodyPart),
    ["elbow_left"]
  );
});

test("hand and face quality affect accuracy and ranked feedback", () => {
  const result = scoreCompositeForm({
    angleTargets,
    liveAngles: {
      elbow_left: 150,
      knee_left: 125,
      fist_left: 40,
      face_forward: 92
    },
    qualityTargets: [
      {
        feature: "fist_left",
        body_part: "fist_left",
        label: "Lead fist closure",
        target: 90,
        min: 70,
        max: 100,
        weight: 2,
        group: "guard"
      },
      {
        feature: "face_forward",
        body_part: "face_forward",
        label: "Head facing forward",
        target: 90,
        min: 75,
        max: 100,
        weight: 1,
        group: "focus"
      }
    ]
  });

  assert.ok(result.accuracy < 100);
  assert.equal(result.groupScores.guard, 0);
  assert.ok(result.groupScores.focus >= 80);
  assert.equal(result.corrections[0].bodyPart, "fist_left");
  assert.ok(result.strengths.some((item) => item.bodyPart === "face_forward"));
});

test("teaching priority ranks fist before larger angle errors", () => {
  const result = scoreCompositeForm({
    angleTargets,
    difficulty: "hard",
    liveAngles: {
      elbow_left: 80,
      knee_left: 175,
      fist_left: 40
    },
    qualityTargets: [
      {
        feature: "fist_left",
        body_part: "fist_left",
        label: "Lead fist closure",
        target: 90,
        min: 70,
        max: 100,
        weight: 1,
        group: "guard"
      }
    ],
    feedbackPriority: ["fist_left", "elbow_left", "knee_left"]
  });

  assert.deepEqual(
    result.corrections.map((item) => item.bodyPart),
    ["fist_left", "elbow_left", "knee_left"]
  );
});

test("biomechanical weight can raise a severe angle correction", () => {
  const result = scoreCompositeForm({
    angleTargets: [
      { ...angleTargets[0], weight: 3 },
      { ...angleTargets[1], weight: 1 }
    ],
    liveAngles: { elbow_left: 100, knee_left: 175 },
    feedbackPriority: ["knee_left", "elbow_left"]
  });

  assert.equal(result.corrections[0].bodyPart, "elbow_left");
  assert.equal(result.corrections[0].weight, 3);
});

test("coach acknowledges success before naming the next correction", () => {
  assert.equal(
    buildCorrectionAcknowledgement(
      { bodyPart: "elbow_left" },
      { bodyPart: "shoulder_right" }
    ),
    "Good lead elbow. Now rear shoulder."
  );
  assert.equal(
    buildCorrectionAcknowledgement({ bodyPart: "knee_left" }, null),
    "Good lead knee. Hold it."
  );
});

test("full-body correction feedback explains knee and hip purpose", () => {
  const kneeMessage = buildCompositeCorrectionFeedback({
    bodyPart: "knee_left",
    current: 160,
    ideal: 125,
    direction: "decrease",
    kind: "angle"
  });
  const hipMessage = buildCompositeCorrectionFeedback({
    bodyPart: "hip_left",
    current: 95,
    ideal: 130,
    direction: "increase",
    kind: "angle"
  });

  assert.match(kneeMessage, /Bend the knee/);
  assert.match(kneeMessage, /front stance/);
  assert.match(hipMessage, /Open the hip/);
  assert.match(hipMessage, /punching power/);
});

test("natural awareness feedback is short and actionable", () => {
  const correctionMessage = buildNaturalAwarenessFeedback({
    correction: {
      bodyPart: "knee_left",
      label: "Bent front knee",
      current: 160,
      ideal: 125,
      direction: "decrease",
      kind: "angle"
    },
    strength: {
      bodyPart: "knee_right",
      label: "Long rear leg",
      current: 165,
      ideal: 165,
      kind: "angle"
    },
    form: { coverage: 82 },
    stepName: "Extend lead hand"
  });
  const trackingMessage = buildNaturalAwarenessFeedback({
    situation: { situation_state: "tracking_unclear" }
  });

  assert.equal(correctionMessage, "Bend your lead knee slightly more.");
  assert.equal(trackingMessage, "Step back; show your full body.");
  assert.ok(correctionMessage.split(/\s+/).length <= 7);
});

test("position feedback is directional and follows angle corrections", () => {
  const positionCorrection = {
    bodyPart: "wrist_left",
    label: "Lead wrist",
    direction: "raise",
    kind: "position",
    score: 20
  };
  const result = scoreCompositeForm({
    angleTargets,
    liveAngles: { elbow_left: 90, knee_left: 125 },
    positionCorrections: [positionCorrection]
  });

  assert.equal(result.corrections[0].kind, "angle");
  assert.equal(result.corrections.at(-1).kind, "position");
  assert.equal(
    buildNaturalAwarenessFeedback({ correction: positionCorrection }),
    "Raise your lead wrist slightly."
  );
});

test("position feedback describes estimated depth movement", () => {
  assert.equal(
    buildNaturalAwarenessFeedback({
      correction: {
        bodyPart: "wrist_right",
        label: "Rear wrist",
        direction: "backward",
        kind: "position"
      }
    }),
    "Bring your rear wrist back slightly."
  );
});
