import assert from "node:assert/strict";
import test from "node:test";

import { deriveForecastAwareness } from "../src/temporal/forecastAwareness.js";
import { SituationAwarenessLayer } from "../src/situationAwareness/SituationAwarenessLayer.js";

function elbowPose(angleDeg) {
  const radians = angleDeg * (Math.PI / 180);
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1
  }));
  landmarks[11] = { x: 0.4, y: 0.5, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  landmarks[15] = {
    x: 0.5 - Math.cos(radians) * 0.1,
    y: 0.5 + Math.sin(radians) * 0.1,
    z: 0,
    visibility: 1
  };
  return landmarks;
}

function prediction(angles) {
  return {
    source: "onnx",
    status: "ready_stabilized",
    prediction_horizon_ms: 1000,
    future_landmark_frames: angles.map((angle, index) => ({
      horizon_ms: (index + 1) * 100,
      landmarks: elbowPose(angle)
    }))
  };
}

test("trusted sustained future angle violations produce a forecast warning", () => {
  const forecast = deriveForecastAwareness({
    prediction: prediction([90, 95, 120, 130, 140, 150, 155, 160, 160, 160]),
    requiredParts: [{ body_part: "elbow_left", min: 50, max: 105 }],
    trackingConfidence: 0.94,
    predictionConfidence: 0.91,
    agreementError: 0.02,
    sourceCounts: { level2: 1 }
  });

  assert.equal(forecast.status, "trusted");
  assert.equal(forecast.trusted, true);
  assert.equal(forecast.likely_mistake.body_part, "elbow_left");
  assert.equal(forecast.likely_mistake.issue, "too_open");
  assert.ok(forecast.risk >= 0.62);
});

test("a disagreeing forecast cannot affect awareness", () => {
  const forecast = deriveForecastAwareness({
    prediction: prediction([130, 140, 150, 160, 160, 160]),
    requiredParts: [{ body_part: "elbow_left", min: 50, max: 105 }],
    trackingConfidence: 0.94,
    predictionConfidence: 0.91,
    agreementError: 0.2,
    sourceCounts: { level2: 2 }
  });

  assert.equal(forecast.trusted, false);
  assert.equal(forecast.status, "untrusted");
  assert.equal(forecast.risk, 0);
  assert.equal(forecast.likely_mistake, null);
});

test("situation awareness emits non-blocking guidance for a trusted future risk", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const state = layer.update({
    level1State: { timestamp: 1, tracking: { confidence: 0.95 } },
    level2State: {
      action_context: {
        mistake_risk: 0.2,
        likely_mistake: null,
        forecast_awareness: {
          trusted: true,
          risk: 0.82,
          horizon_ms: 1000,
          agreement_error: 0.02,
          likely_mistake: {
            body_part: "elbow_left",
            issue: "too_open",
            first_risk_ms: 500
          }
        }
      }
    },
    level3State: {
      session_context: {
        fatigue_risk: 0.1,
        mastery_score: 0.4,
        recommendation: "continue",
        trend: "stable"
      }
    },
    level4State: {
      user_context: { progression: {}, personalization: {} }
    }
  });

  assert.equal(state.situation_context.situation_state, "anticipating");
  assert.equal(state.situation_context.feedback_decision.type, "predictive_guidance");
  assert.equal(state.situation_context.feedback_decision.should_pause_progression, false);
  assert.equal(state.situation_context.next_action.command, "prepare_correction");
});

function awarenessContext(actionContext) {
  return {
    level1State: { timestamp: 1, tracking: { confidence: 0.95 } },
    level2State: { action_context: { mistake_risk: 0.2, likely_mistake: null, ...actionContext } },
    level3State: { session_context: { fatigue_risk: 0.1, mastery_score: 0.4, recommendation: "continue", trend: "stable" } },
    level4State: { user_context: { progression: {}, personalization: {} } }
  };
}

test("current XYZ evidence can drive a situation correction", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const state = layer.update(awarenessContext({
    spatial_awareness: {
      risk: 0.78,
      top_issue: { bodyPart: "wrist_left", axis: "z", direction: "forward" }
    }
  }));

  assert.equal(state.situation_context.situation_state, "correcting");
  assert.equal(state.situation_context.attention_target.layer, "level1_spatial");
  assert.equal(state.situation_context.reasoning.spatial_dimension, "z");
  assert.match(state.situation_context.feedback_decision.message, /forward/);
});

test("trusted predicted XYZ evidence creates anticipatory guidance", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const state = layer.update(awarenessContext({
    spatial_forecast: {
      trusted: true,
      risk: 0.8,
      horizon_ms: 500,
      top_issue: { bodyPart: "wrist_left", axis: "y", direction: "lower" }
    }
  }));

  assert.equal(state.situation_context.situation_state, "anticipating");
  assert.equal(state.situation_context.attention_target.layer, "level2_spatial_forecast");
  assert.equal(state.situation_context.feedback_decision.type, "predictive_guidance");
  assert.equal(state.situation_context.feedback_decision.should_pause_progression, false);
});
