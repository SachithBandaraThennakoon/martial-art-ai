import json
import unittest

from fastapi import HTTPException

from services.tape_storage import parse_and_validate_tape


def valid_document():
    return {
        "version": 2,
        "frame_rate": 30,
        "duration_ms": 34,
        "frames": [
            {
                "t": 0,
                "n": 1,
                "p": [[1000, 2000, 0, 10000]],
                "op": [],
                "wp": [],
                "ap": [],
                "face": [],
                "hl": [],
                "hr": [],
                "av": {"left_elbow": 17800},
            },
            {
                "t": 34,
                "n": 2,
                "p": [[1200, 2000, 0, 10000]],
                "op": [],
                "wp": [],
                "ap": [],
                "face": [],
                "hl": [],
                "hr": [],
            },
        ],
        "metadata": {
            "sessionId": 7,
            "targetReps": 3,
            "techniqueName": "Jab",
            "algorithmVersion": "biomechanics-v2",
            "configVersion": "jab-2026-08",
            "deviceGeneratedEstimate": True,
        },
    }


class TapeStorageValidationTests(unittest.TestCase):
    def test_valid_compact_tape_has_stable_checksum(self):
        raw = json.dumps(valid_document(), separators=(",", ":")).encode()
        document, digest = parse_and_validate_tape(raw)
        self.assertEqual(len(document["frames"]), 2)
        self.assertEqual(len(digest), 64)

    def test_unknown_frame_field_is_rejected(self):
        document = valid_document()
        document["frames"][0]["rawVideo"] = "not allowed"
        with self.assertRaises(HTTPException) as context:
            parse_and_validate_tape(json.dumps(document).encode())
        self.assertEqual(context.exception.status_code, 422)

    def test_out_of_order_timestamps_are_rejected(self):
        document = valid_document()
        document["frames"][1]["t"] = -1
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())

    def test_non_numeric_landmarks_are_rejected(self):
        document = valid_document()
        document["frames"][0]["p"][0][0] = "1000"
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())

    def test_unknown_metadata_is_rejected(self):
        document = valid_document()
        document["metadata"]["email"] = "should-not-be-here@example.com"
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())


if __name__ == "__main__":
    unittest.main()
