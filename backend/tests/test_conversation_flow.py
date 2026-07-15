import unittest

from agents.conversation_intent_agent import ConversationIntentAgent
from agents.training_coach import CoachSession


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
    def test_session_starts_with_a_real_ready_check(self):
        coach = CoachSession(current_step_name="Guard stance", total_steps=2)
        message = coach.initial_greeting()
        event = coach.panel_event(message, action="confirm_start")

        self.assertTrue(event["requires_response"])
        self.assertEqual(event["question"]["kind"], "ready")
        self.assertTrue(coach.is_paused)
        self.assertEqual(coach.user_message("yes")["action"], "observe")

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
