import unittest

from services.practice_analytics import extract_practice_analytics


class PracticeAnalyticsTests(unittest.TestCase):
    def test_extracts_compact_post_session_summary(self):
        payload = extract_practice_analytics({
            "captureDurationMs": 8400,
            "targetReps": 3,
            "canonicalCompletedReps": 3,
            "canonicalTargetReps": 3,
            "correctedSummary": {"completed_reps": 3},
            "ruleEngineAnalysis": {
                "summary": {
                    "completed_repetitions": 3,
                    "aborted_repetitions": 1,
                    "average_response_time_ms": 420,
                    "tracking_quality_percentage": 94.5,
                    "per_step_duration_ms": {"EXTENSION": 180},
                    "common_form_errors": [
                        {"error_id": "dropped_guard", "count": 2}
                    ],
                    "corrections_applied": 4,
                }
            },
        })

        self.assertEqual(payload["completed_repetitions"], 3)
        self.assertEqual(payload["aborted_repetitions"], 0)
        self.assertEqual(payload["average_response_time_ms"], 420)
        self.assertEqual(payload["tracking_quality_percentage"], 94.5)
        self.assertEqual(payload["common_form_errors"][0]["error_id"], "dropped_guard")
        self.assertEqual(payload["per_step_duration_ms"]["EXTENSION"], 180)
        self.assertEqual(payload["capture_duration_ms"], 8400)

    def test_missing_rule_summary_stays_explicitly_unavailable(self):
        payload = extract_practice_analytics({
            "correctedSummary": {"completed_reps": 2}
        })

        self.assertEqual(payload["completed_repetitions"], 2)
        self.assertIsNone(payload["tracking_quality_percentage"])
        self.assertIsNone(payload["average_response_time_ms"])
        self.assertEqual(payload["common_form_errors"], [])


if __name__ == "__main__":
    unittest.main()
