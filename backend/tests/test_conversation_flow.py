import unittest
import time

from agents.conversation_intent_agent import ConversationIntentAgent
from agents.training_coach import CoachSession, QUESTION_REMINDER_SECONDS


class ConversationIntentAgentTests(unittest.TestCase):
    def setUp(self):
        self.agent = ConversationIntentAgent()

    def test_yes_uses_question_context(self):
        self.assertEqual(self.agent.classify("yes", "ready").name, "ready")
        self.assertEqual(self.agent.classify("yes", "next_step").name, "next")
        self.assertEqual(self.agent.classify("yes", "practice").name, "practice")

    def test_no_uses_question_context(self):
        self.assertEqual(self.agent.classify("no", "ready").name, "not_ready")
        self.assertEqual(self.agent.classify("no", "next_step").name, "repeat_step")
        self.assertEqual(self.agent.classify("no thanks", "practice").name, "train")

    def test_natural_phrases(self):
        self.assertEqual(self.agent.classify("Can you help me?").name, "focus_help")
        self.assertEqual(self.agent.classify("I am ready now").name, "ready")
        self.assertEqual(self.agent.classify("Let's move on").name, "next")


class CoachConversationFlowTests(unittest.TestCase):
    def test_step_cannot_complete_with_any_incorrect_target(self):
        coach = CoachSession()

        self.assertFalse(coach._can_complete_step(99, []))
        self.assertTrue(coach._can_complete_step(100, []))

    def test_missing_auxiliary_evidence_is_advisory_but_measured_errors_block(self):
        coach = CoachSession()
        missing_fist = {"body_part": "fist_left", "issue": "missing"}
        wrong_fist = {"body_part": "fist_left", "issue": "too_closed"}

        self.assertTrue(coach._can_complete_step(100, [missing_fist]))
        self.assertFalse(coach._can_complete_step(100, [wrong_fist]))

    def test_correction_order_is_angles_then_hands_then_face(self):
        coach = CoachSession()
        body_issue = {
            "body_part": "knee_left",
            "issue": "too_open",
            "severity": 20,
        }
        hand_issue = {
            "body_part": "fist_left",
            "issue": "too_closed",
            "severity": 30,
        }
        face_issue = {
            "body_part": "face_forward",
            "issue": "too_closed",
            "severity": 40,
        }

        self.assertEqual(
            coach._ordered_focus_issues(
                [face_issue, hand_issue],
                [body_issue],
            )[0]["body_part"],
            "knee_left",
        )
        self.assertEqual(
            coach._ordered_focus_issues([face_issue, hand_issue], [])[0][
                "body_part"
            ],
            "fist_left",
        )

    def test_session_starts_with_a_real_ready_check(self):
        coach = CoachSession(current_step_name="Guard stance", total_steps=2)
        message = coach.initial_greeting()
        event = coach.panel_event(message, action="confirm_start")

        self.assertTrue(event["requires_response"])
        self.assertEqual(event["question"]["kind"], "ready")
        self.assertTrue(coach.is_paused)
        self.assertEqual(coach.user_message("yes")["action"], "observe")

    def test_ready_question_is_one_semantic_feedback_until_reminder(self):
        coach = CoachSession(current_step_name="Guard stance", total_steps=2)
        greeting = coach.panel_event(coach.initial_greeting(), action="confirm_start")
        waiting = coach.movement_event(
            "guard",
            "Guard stance",
            [{"body_part": "elbow_left", "min": 70, "max": 105}],
            {"elbow_left": 60},
        )

        self.assertEqual(greeting["feedback_intent"], "question:ready")
        self.assertEqual(waiting["feedback_intent"], "question:ready")
        self.assertFalse(waiting["speak"])

        coach.question_asked_at = time.monotonic() - QUESTION_REMINDER_SECONDS - 1
        reminder = coach.movement_event(
            "guard",
            "Guard stance",
            [{"body_part": "elbow_left", "min": 70, "max": 105}],
            {"elbow_left": 60},
        )
        self.assertEqual(reminder["feedback_intent"], "question:ready:reminder")
        self.assertEqual(reminder["action"], "attention_prompt")
        self.assertNotEqual(reminder["message"], "Are you ready to begin?")

    def test_live_intelligence_does_not_compete_with_pending_question(self):
        coach = CoachSession()
        coach.initial_greeting()
        self.assertIsNone(coach.intelligence_context_event({"situation_awareness": {}}))

    def test_step_completion_waits_for_user(self):
        coach = CoachSession(
            current_step_key="guard",
            current_step_name="Guard stance",
            current_step_index=0,
            total_steps=2,
        )
        event = coach._complete_step_event("guard", 96, [])

        self.assertEqual(event["action"], "confirm_next")
        self.assertEqual(event["question"]["kind"], "next_step")
        self.assertNotIn("next_step_index", event)

        next_event = coach.user_message("next step")
        self.assertEqual(next_event["action"], "advance_step")
        self.assertEqual(next_event["next_step_index"], 1)

    def test_user_can_repeat_instead_of_advancing(self):
        coach = CoachSession(
            current_step_name="Guard stance",
            current_step_index=0,
            total_steps=2,
        )
        coach._complete_step_event("guard", 96, [])

        event = coach.user_message("no")
        self.assertEqual(event["action"], "repeat_step")
        self.assertFalse(event["requires_response"])

    def test_completed_session_offers_clear_choices(self):
        coach = CoachSession(current_step_index=1, total_steps=2)
        event = coach._complete_step_event("return", 98, [])

        self.assertEqual(event["question"]["kind"], "session_complete")
        self.assertEqual(
            [option["label"] for option in event["question"]["options"]],
            ["Practice", "Train again", "Finish"],
        )
        self.assertEqual(coach.user_message("finish session")["action"], "complete")


if __name__ == "__main__":
    unittest.main()
