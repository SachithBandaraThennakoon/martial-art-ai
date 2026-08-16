import unittest

from awareness.attention import AttentionEngine
from awareness.prediction import MultihorizonPredictionEngine
from awareness.reasoning import DecisionPolicy
from awareness.relationships import L1RelationshipEngine
from awareness.schemas import TemporalState, WorldObject


def entity(identifier="user:primary", kind="human", position=None, velocity=None, l2=None, l3=None):
    return WorldObject(
        object_id=identifier, object_type=kind, source="test", confidence=.9, verified=True,
        attributes={"position": position} if position is not None else {},
        state=TemporalState(
            l1={"velocity": velocity, "prediction_confidence": .8} if velocity is not None else {},
            l2=l2 or {}, l3=l3 or {},
        ),
    )


class PredictionTests(unittest.TestCase):
    def test_projects_verified_motion_at_two_horizons(self):
        result = MultihorizonPredictionEngine().predict([
            entity(position=[0, 0], velocity=[2, 0])
        ], [])
        forecast = result["objects"]["user:primary"]
        self.assertEqual(forecast["plus_100ms"]["position"], (.2, 0))
        self.assertEqual(forecast["plus_1s"]["position"], (2, 0))
        self.assertTrue(forecast["plus_100ms"]["trusted"])

    def test_gates_prediction_without_motion_or_action_evidence(self):
        result = MultihorizonPredictionEngine().predict([entity()], [])
        self.assertTrue(result["gated"])
        self.assertEqual(result["trusted_forecast_count"], 0)

    def test_predicts_relationship_collision_from_relative_motion(self):
        objects = [
            entity(position=[0, 0], velocity=[0, 0]),
            entity("opponent:1", "opponent", position=[1, 0], velocity=[-.9, 0]),
        ]
        relationships = L1RelationshipEngine().build(objects)
        result = MultihorizonPredictionEngine().predict(objects, relationships)
        future = next(iter(result["relationships"].values()))["plus_1s"]
        self.assertAlmostEqual(future["distance"], .1)
        self.assertTrue(future["collision_risk"])


class DecisionPolicyTests(unittest.TestCase):
    def decide(self, state, confidence=.8, prediction=None):
        objects = [entity()]
        attention = AttentionEngine().score({}, objects, [])
        return DecisionPolicy().decide(
            {"type": "improve_user_technique"},
            {"situation_state": state, "confidence": confidence, "reason": "test", "evidence": []},
            prediction or {"objects": {}, "relationships": {}, "trusted_forecast_count": 0},
            attention,
        )

    def test_hazard_is_the_only_forced_pause(self):
        hazard = self.decide("hazard_detected")
        correction = self.decide("correcting")
        self.assertTrue(hazard["pause_training"])
        self.assertFalse(correction["pause_training"])
        self.assertEqual(hazard["feedback"]["type"], "safety")

    def test_tracking_unclear_requests_camera_recovery(self):
        decision = self.decide("tracking_unclear", .2)
        self.assertEqual(decision["command"], "improve_camera_view")
        self.assertTrue(decision["should_speak"])

    def test_trusted_forecast_is_included_as_evidence(self):
        prediction = {
            "trusted_forecast_count": 1,
            "objects": {"user:primary": {"plus_1s": {
                "trusted": True, "likely_mistake": {"issue": "guard_drop"}
            }}},
            "relationships": {},
        }
        decision = self.decide("correcting", prediction=prediction)
        self.assertEqual(len(decision["forecast_risks"]), 1)
        self.assertGreater(decision["confidence"], .8)


if __name__ == "__main__":
    unittest.main()
