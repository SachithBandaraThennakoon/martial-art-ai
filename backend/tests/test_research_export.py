import unittest
import zlib
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from services.research_export import build_research_export


class ResearchExportTests(unittest.TestCase):
    def test_export_is_pseudonymous_and_includes_machine_evidence(self):
        now = datetime(2026, 8, 1, tzinfo=timezone.utc)
        session = SimpleNamespace(
            id=7, technique_name="Jab", step_key=None, step_name=None,
            target_reps=3, completed_reps=3, clean_reps=2,
            average_accuracy=88.0, best_accuracy=94.0, average_rep_seconds=1.2,
            consistency_score=91.0, status="completed", started_at=now, ended_at=now,
        )
        rep = SimpleNamespace(
            practice_session_id=7, rep_number=1, accuracy=88.0, duration_ms=1200,
            speed_label="normal", quality_label="clean", focus_body_part="elbow",
            issue=None, started_at=now, ended_at=now,
        )
        raw = json.dumps({"frames": [{"t": 1}], "metadata": {}}).encode()
        tape = SimpleNamespace(
            version=1, frame_rate=30, frame_count=1, duration_ms=34,
            codec="zlib-json", payload=zlib.compress(raw), compressed_bytes=20,
            uncompressed_bytes=len(raw), created_at=now, updated_at=now,
        )
        document = build_research_export(
            practice_sessions=[session], practice_reps=[rep],
            practice_analytics={7: {"tracking_quality_percentage": 95}},
            practice_tapes={7: tape}, training_sessions=[], training_steps=[],
            feedback_events=[], generated_at="2026-08-01T00:00:00+00:00",
        )
        self.assertEqual(document["participant_id"], "P001")
        self.assertFalse(document["scope"]["raw_video_included"])
        self.assertEqual(document["practice_sessions"][0]["tape"]["document"]["frames"][0]["t"], 1)
        self.assertEqual(len(document["content_sha256"]), 64)
        self.assertNotIn("email", json.dumps(document).lower())


if __name__ == "__main__":
    unittest.main()
