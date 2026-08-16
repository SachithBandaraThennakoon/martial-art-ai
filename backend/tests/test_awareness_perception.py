import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from awareness.perception import (
    GeometryObservation, HumanObservation, ObjectDetection, PerceptionEnvelope,
    PerceptionFusionEngine, SurfaceObservation, perception_module_status,
)


class PerceptionFusionTests(unittest.TestCase):
    def test_fuses_verified_human_object_and_floor_without_raw_media(self):
        envelope = PerceptionEnvelope(
            session_key="perception.test", sequence=1,
            human=HumanObservation(confidence=.9, l1={"velocity": [0, 0]}),
            objects=[ObjectDetection(
                detection_id="weapon-1", object_type="weapon", confidence=.8,
                bbox=[.1, .2, .1, .2],
            )],
            surfaces=[SurfaceObservation(
                surface_id="floor:primary", surface_type="floor", confidence=.8,
            )],
            geometry=GeometryObservation(
                confidence=.7,
                positions={"weapon-1": [1, 0, 0]},
                ground_plane=[0, 1, 0, 0],
            ),
        )
        result = PerceptionFusionEngine().fuse(envelope)
        self.assertEqual(len(result.objects), 3)
        self.assertTrue(all(item.verified for item in result.objects))
        weapon = next(item for item in result.objects if item.object_type == "weapon")
        self.assertEqual(weapon.attributes["position"], [1, 0, 0])
        self.assertFalse(result.metadata["perception"]["raw_media_stored"])

    def test_low_confidence_and_surface_without_geometry_remain_unverified(self):
        result = PerceptionFusionEngine().fuse(PerceptionEnvelope(
            session_key="perception.test", sequence=1,
            objects=[ObjectDetection(
                detection_id="maybe", object_type="weapon", confidence=.2,
                bbox=[0, 0, .1, .1],
            )],
            surfaces=[SurfaceObservation(
                surface_id="floor:primary", surface_type="floor", confidence=.9,
            )],
        ))
        self.assertFalse(result.objects[0].verified)
        self.assertFalse(result.objects[1].verified)

    def test_contract_rejects_raw_frame_fields(self):
        with self.assertRaises(ValidationError):
            PerceptionEnvelope.model_validate({
                "session_key": "bad.raw", "sequence": 1, "rgb_frame": "base64-data"
            })

    def test_module_status_is_truthful_when_model_is_missing(self):
        with patch.dict(os.environ, {"OBJECT_DETECTOR_ENABLED": "true", "OBJECT_DETECTOR_MODEL_PATH": "missing.onnx"}):
            objects = next(item for item in perception_module_status() if item["key"] == "objects")
            self.assertEqual(objects["status"], "model_missing")


if __name__ == "__main__":
    unittest.main()
