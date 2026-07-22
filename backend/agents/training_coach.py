import time
from dataclasses import dataclass, field
from types import SimpleNamespace

from agents.conversation_intent_agent import ConversationIntentAgent
from agents.movement_agent import analyze_movement


ACCURACY_TO_ADVANCE = 90
ACCURACY_HOLD_SECONDS = 5
VOICE_FEEDBACK_COOLDOWN_SECONDS = 6
QUESTION_REMINDER_SECONDS = 15
TREND_SPEAK_DELTA = 3
STEADY_REMINDER_FRAMES = 16
READINESS_TARGETS = {
    "face_forward",
    "eyes_forward",
    "face_calm",
    "fist_left",
    "fist_right",
    "hand_left_open",
    "hand_right_open",
}
FACE_READINESS_TARGETS = {"face_forward", "eyes_forward", "face_calm"}
HAND_READINESS_TARGETS = {
    "fist_left",
    "fist_right",
    "hand_left_open",
    "hand_right_open",
}


@dataclass
class CoachSession:
    technique_name: str = "this technique"
    student_name: str | None = None
    mode: str = "train"
    current_step_key: str | None = None
    current_step_name: str = "selected step"
    current_step_index: int = 0
    total_steps: int = 0
    state: str = "confirm_start"
    last_feedback: str = ""
    last_spoken_message: str = ""
    active_body_part: str | None = None
    active_issue: str | None = None
    is_ready: bool = True
    is_paused: bool = False
    attention_score: int = 100
    correction_frames: int = 0
    missing_pose_frames: int = 0
    plateau_frames: int = 0
    last_accuracy: int = 0
    readiness_prompted: bool = False
    practice_suggested: bool = False
    pending_question: str | None = None
    last_user_intent: str = "unknown"
    completed_steps: set[str] = field(default_factory=set)
    recent_user_messages: list[str] = field(default_factory=list)
    recent_feedback: list[str] = field(default_factory=list)
    recent_intelligence_contexts: list[dict] = field(default_factory=list)
    body_part_trends: dict[str, dict] = field(default_factory=dict)
    last_spoken_corrections: dict[str, int] = field(default_factory=dict)
    pending_speech_focus: dict | None = None
    last_situation_signature: str = ""
    high_accuracy_started_at: float | None = None
    high_accuracy_last_prompt_second: int | None = None
    last_spoken_at: float = 0.0
    question_asked_at: float = 0.0
    question_reminders: int = 0
    intent_agent: ConversationIntentAgent = field(default_factory=ConversationIntentAgent)

    def user_message(self, message):
        text = (message or "").strip()
        if not text:
            return self.panel_event(
                "I did not hear an answer. Use one of the choices below.",
                action="listening"
            )

        self.recent_user_messages = (self.recent_user_messages + [text])[-6:]
        intent = self.intent_agent.classify(text, self.pending_question).name
        self.last_user_intent = intent

        if intent == "finish":
            self.is_ready = False
            self.is_paused = True
            self._clear_pending_question()
            self.state = "session_complete"
            return self.panel_event(
                "Session finished. Good work today.",
                action="complete"
            )

        if self.state == "confirm_step_complete" and intent == "repeat_step":
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()
            self.state = "observe_pose"
            return self.panel_event(
                f"Good choice. Repeat {self.current_step_name}.",
                action="repeat_step"
            )

        if self.state in {"confirm_session_complete", "session_complete"} and intent in {"ready", "next", "train", "repeat"}:
            self.completed_steps.clear()
            self._reset_temporal_focus()
            self.state = "restart_training"
            return self.panel_event(
                "Good. Start again.",
                action="restart_training"
            )

        if self.state == "confirm_step_complete" and intent in {"ready", "next", "train"}:
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()
            return self.panel_event(
                "Good. Next step.",
                action="advance_step",
                next_step_index=self._next_step_index()
            )

        if intent == "practice":
            self.mode = "practice"
            self.state = "practice"
            self.is_paused = False
            self._reset_temporal_focus(keep_ready=False)
            return self.panel_event(
                "Practice mode ready.",
                action="switch_practice"
            )

        if intent == "repeat":
            self.completed_steps.clear()
            self._reset_temporal_focus()
            self.is_ready = True
            self.state = "restart_training"
            return self.panel_event(
                "Good. Start again.",
                action="restart_training"
            )

        if self.pending_question == "practice" and intent in {"ready", "train", "next"}:
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()
            self.state = "observe_pose"
            return self.panel_event(
                f"Good. Focus {self._active_label()}.",
                action="observe"
            )

        if intent in {"ready", "train"}:
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()
            self.readiness_prompted = False
            self.state = "observe_pose"
            if self.active_body_part:
                return self.panel_event(
                    f"Good. Focus {self._active_label()}.",
                    action="observe"
                )

            return self.panel_event(
                f"Good. Start {self.current_step_name}.",
                action="observe"
            )

        if intent == "not_ready":
            self.is_ready = False
            self.is_paused = True
            if not self.pending_question:
                self._set_pending_question("ready")
                self.state = "waiting"
            return self.panel_event(
                "No rush. I will wait for your answer.",
                action="wait"
            )

        if intent == "next":
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()

            if self._is_final_step():
                self.state = "confirm_session_complete"
                return self.panel_event(
                    "Practice or train again?",
                    action="session_complete_prompt"
                )

            self.state = "confirm_step_complete"
            return self.panel_event(
                "Good. Next step.",
                action="advance_step",
                next_step_index=self._next_step_index()
            )

        if intent == "focus_help":
            self.attention_score = max(30, self.attention_score - 10)
            return self.panel_event(
                "One point only.",
                action="focus_prompt"
            )

        if intent == "check_correct":
            if self.last_accuracy >= ACCURACY_TO_ADVANCE:
                return self.panel_event(
                    "Yes. Correct.",
                    action="confirm_correct"
                )

            return self.panel_event(
                "Not yet. Keep correcting.",
                action="confirm_incorrect"
            )

        choices = self._question_option_labels()
        message = (
            f"Please choose: {', '.join(choices)}."
            if choices
            else "Say ready, wait, practice, or help."
        )
        return self.panel_event(message, action="clarify", speak=False)

    def movement_event(self, step_key, step_name, required_parts, live_angles):
        self.current_step_key = step_key
        self.current_step_name = step_name or self.current_step_name

        if self.state == "confirm_session_complete":
            return self._waiting_for_answer_event(self.last_accuracy, issue="complete")

        if self.state == "confirm_step_complete":
            return self._waiting_for_answer_event(self.last_accuracy, issue="complete")

        if not required_parts:
            return self.panel_event(
                "No target angles are loaded for this step yet.",
                accuracy=0,
                action="needs_targets"
            )

        parts = [_part_to_namespace(part) for part in required_parts]
        analysis = analyze_movement(parts, live_angles or {})
        correct = sum(1 for item in analysis if item["issue"] == "good")
        accuracy = int((correct / len(parts)) * 100) if parts else 0
        issues = [
            item for item in sorted(
                analysis,
                key=lambda entry: entry["severity"] or 0,
                reverse=True
            )
            if item["issue"] != "good"
        ]
        readiness_issues = [
            item for item in issues
            if self._is_readiness_target(item["body_part"])
        ]
        body_issues = [
            item for item in issues
            if not self._is_readiness_target(item["body_part"])
        ]
        ordered_issues = self._ordered_focus_issues(readiness_issues, body_issues)

        if self.is_paused and self.pending_question == "practice":
            if self._question_reminder_due():
                return self._waiting_for_answer_event(accuracy, analysis=analysis)

            sustained_event = self._sustained_accuracy_event(step_key, accuracy, readiness_issues, analysis)
            if sustained_event:
                if sustained_event.get("action") in {"advance_step", "session_complete_prompt"}:
                    self.is_paused = False
                    self._clear_pending_question()
                    self.practice_suggested = False
                return sustained_event

            focus = ordered_issues[0] if ordered_issues else None
            message = "Practice or continue?"
            body_part = None
            issue_name = "waiting"
            if focus:
                self.active_body_part = focus["body_part"]
                self.active_issue = focus["issue"]
                message = self._trend_cue(focus)
                body_part = focus["body_part"]
                issue_name = focus["issue"]

            return self.panel_event(
                message,
                accuracy=accuracy,
                action="waiting",
                analysis=analysis,
                body_part=body_part,
                issue=issue_name,
                speak=False
            )

        if self.is_paused:
            if not self.readiness_prompted:
                self.readiness_prompted = True
                self._set_pending_question("ready")
                return self.panel_event(
                    "Ready?",
                    accuracy=accuracy,
                    action="ask_ready",
                    analysis=analysis
                )

            return self._waiting_for_answer_event(accuracy, analysis=analysis)

        if not self.is_ready:
            self.is_ready = True
            self.is_paused = False
            self._clear_pending_question()

        self._update_attention_memory(analysis)
        self._update_plateau_memory(accuracy)

        sustained_event = self._sustained_accuracy_event(step_key, accuracy, readiness_issues, analysis)
        if sustained_event:
            return sustained_event

        active_item = self._active_issue_item(analysis)

        if (
            readiness_issues
            and active_item
            and not self._is_readiness_target(active_item["body_part"])
        ):
            active_item = None
            self.active_body_part = None
            self.active_issue = None

        if self.missing_pose_frames >= 3:
            self.state = "focus_check"
            message = "I am losing your body in the camera. Can you focus and step fully into frame?"
            return self.panel_event(
                message,
                accuracy=accuracy,
                action="ask_focus",
                analysis=analysis,
                speak=self._should_speak(message)
            )

        if active_item and active_item["issue"] == "good":
            corrected_label = self._sentence_label(active_item["label"])
            self.active_body_part = None
            self.active_issue = None

            next_issue = ordered_issues[0] if ordered_issues else None
            if next_issue:
                self.active_body_part = next_issue["body_part"]
                self.active_issue = next_issue["issue"]
                self.correction_frames = 0
                message = self._focused_cue(next_issue)
                body_part = next_issue["body_part"]
                issue_name = next_issue["issue"]
            else:
                message = "Good. Hold shape."
                body_part = None
                issue_name = "good"
        else:
            focus = active_item if active_item and active_item["issue"] != "good" else None

            if focus is None and ordered_issues:
                focus = ordered_issues[0]
                self.active_body_part = focus["body_part"]
                self.active_issue = focus["issue"]
                self.correction_frames = 0

            if focus:
                self.correction_frames += 1
                message = self._trend_cue(focus)
                if self._should_offer_practice():
                    self.practice_suggested = True
                    self._set_pending_question("practice")
                    self.is_paused = True
                    message = f"{message} Would you like focused practice?"
                    body_part = focus["body_part"]
                    issue_name = "practice_suggested"
                elif (
                    self.correction_frames in {4, 10}
                    or self.correction_frames % STEADY_REMINDER_FRAMES == 0
                ):
                    message = self._trend_cue(focus, force_short=True)
                    body_part = focus["body_part"]
                    issue_name = "focus_check"
                else:
                    body_part = focus["body_part"]
                    issue_name = focus["issue"]
            else:
                message = "Good. Hold position."
                body_part = None
                issue_name = "good"

        speak = self._should_speak(message)
        self.state = "give_feedback"
        self.last_feedback = message
        self.recent_feedback = (self.recent_feedback + [message])[-8:]

        return self.panel_event(
            message,
            accuracy=accuracy,
            action="correct",
            analysis=analysis,
            body_part=body_part,
            issue=issue_name,
            speak=speak
        )

    def complete_session(self):
        self.state = "confirm_session_complete"
        self.is_paused = True
        self._set_pending_question("session_complete")
        return self.panel_event(
            "Session complete. Practice, train again, or finish?",
            action="session_complete_prompt"
        )

    def intelligence_context_event(self, packet):
        if not isinstance(packet, dict):
            return None

        # A question owns the conversation until the student answers it. Live
        # intelligence may keep updating metrics, but it must not introduce a
        # competing correction or restate the same question.
        if self.pending_question or self.is_paused:
            return None

        situation = packet.get("situation_awareness") or {}
        temporal_layers = packet.get("temporal_layers") or {}
        agent_context = situation.get("agent_context") or {}
        feedback_decision = situation.get("feedback_decision") or {}
        next_action = situation.get("next_action") or {}
        reasoning = situation.get("reasoning") or {}
        attention_target = situation.get("attention_target") or {}
        situation_state = situation.get("situation_state") or "observing"

        self.recent_intelligence_contexts = (
            self.recent_intelligence_contexts + [
                {
                    "timestamp": packet.get("timestamp"),
                    "technique": packet.get("technique"),
                    "current_step": packet.get("current_step"),
                    "situation_state": situation_state,
                    "attention_target": attention_target,
                    "feedback_decision": feedback_decision,
                    "next_action": next_action,
                    "reasoning": reasoning,
                    "temporal_layers": temporal_layers,
                }
            ]
        )[-8:]

        if packet.get("technique"):
            self.technique_name = packet.get("technique")
        current_step = packet.get("current_step") or {}
        if current_step.get("id") is not None:
            self.current_step_key = current_step.get("id")
        if current_step.get("name"):
            self.current_step_name = current_step.get("name")

        signature = ":".join(
            str(value or "")
            for value in [
                situation_state,
                agent_context.get("action"),
                agent_context.get("target"),
                agent_context.get("issue"),
            ]
        )
        decision_score = reasoning.get("decision_score") or 0
        should_speak = bool(feedback_decision.get("should_speak"))
        important = (
            situation_state in {"tracking_unclear", "warning", "correcting", "advance_ready"}
            or decision_score >= 0.68
        )

        if not important or signature == self.last_situation_signature:
            return None

        self.last_situation_signature = signature
        effective_target = self._best_short_term_focus(attention_target)
        message = self._intelligence_message(
            situation_state=situation_state,
            feedback_decision=feedback_decision,
            attention_target=effective_target,
            next_action=next_action,
            temporal_layers=temporal_layers,
        )
        action = self._coach_action_from_intelligence(situation_state, next_action)

        self.active_body_part = effective_target.get("body_part") or self.active_body_part
        self.active_issue = effective_target.get("issue") or self.active_issue
        self.last_feedback = message
        self.recent_feedback = (self.recent_feedback + [message])[-8:]

        return self.panel_event(
            message,
            accuracy=int((temporal_layers.get("level3_session", {}).get("mastery_score") or 0) * 100),
            action=action,
            body_part=effective_target.get("body_part"),
            issue=effective_target.get("issue"),
            speak=should_speak,
            intelligence_context={
                "situation_awareness": situation,
                "temporal_summary": temporal_layers,
            },
        )

    def initial_greeting(self):
        name_prefix = f"Hello {self.student_name}. " if self.student_name else ""
        self.is_ready = False
        self.is_paused = True
        self.readiness_prompted = True
        self.state = "confirm_start"
        self._set_pending_question("ready")
        return (
            f"{name_prefix}I will guide one step at a time and keep corrections short. "
            "Are you ready to begin?"
        )

    def panel_event(
        self,
        message,
        accuracy=0,
        action="coach",
        analysis=None,
        body_part=None,
        issue=None,
        speak=True,
        next_step_index=None,
        intelligence_context=None
    ):
        event = {
            "type": "coach",
            "mode": self.mode,
            "state": self.state,
            "action": action,
            "message": message,
            "feedback": [message],
            "summary": message,
            "current_step_index": self.current_step_index,
            "total_steps": self.total_steps,
            "accuracy": accuracy,
            "body_part": body_part,
            "issue": issue,
            "speak": speak,
            "feedback_intent": self._feedback_intent(action, body_part, issue),
            "focus_body_part": self.active_body_part,
            "analysis": analysis or [],
            "requires_response": bool(self.pending_question),
            "question": self._question_payload(),
            "memory": {
                "recent_user_messages": self.recent_user_messages,
                "recent_feedback": self.recent_feedback,
                "recent_intelligence_contexts": self.recent_intelligence_contexts,
                "completed_steps": list(self.completed_steps),
                "ready": self.is_ready,
                "paused": self.is_paused,
                "attention_score": self.attention_score,
                "correction_frames": self.correction_frames,
                "plateau_frames": self.plateau_frames,
                "last_user_intent": self.last_user_intent,
                "pending_question": self.pending_question,
            }
        }

        if next_step_index is not None:
            event["next_step_index"] = next_step_index

        if intelligence_context is not None:
            event["intelligence_context"] = intelligence_context

        return event

    def to_memory(self):
        return {
            "technique_name": self.technique_name,
            "student_name": self.student_name,
            "mode": self.mode,
            "current_step_key": self.current_step_key,
            "current_step_name": self.current_step_name,
            "current_step_index": self.current_step_index,
            "total_steps": self.total_steps,
            "state": self.state,
            "last_feedback": self.last_feedback,
            "last_spoken_message": self.last_spoken_message,
            "active_body_part": self.active_body_part,
            "active_issue": self.active_issue,
            "is_ready": self.is_ready,
            "is_paused": self.is_paused,
            "attention_score": self.attention_score,
            "correction_frames": self.correction_frames,
            "missing_pose_frames": self.missing_pose_frames,
            "plateau_frames": self.plateau_frames,
            "last_accuracy": self.last_accuracy,
            "readiness_prompted": self.readiness_prompted,
            "practice_suggested": self.practice_suggested,
            "pending_question": self.pending_question,
            "last_user_intent": self.last_user_intent,
            "completed_steps": list(self.completed_steps),
            "recent_user_messages": self.recent_user_messages,
            "recent_feedback": self.recent_feedback,
            "recent_intelligence_contexts": self.recent_intelligence_contexts,
            "body_part_trends": self.body_part_trends,
            "last_spoken_corrections": self.last_spoken_corrections,
            "last_situation_signature": self.last_situation_signature,
        }

    def restore_memory(self, memory):
        if not isinstance(memory, dict):
            return

        for key, value in memory.items():
            if key == "completed_steps":
                self.completed_steps = set(value or [])
            elif hasattr(self, key):
                setattr(self, key, value)

        if self.pending_question:
            self.question_asked_at = time.monotonic()
            self.question_reminders = 0

    def _set_pending_question(self, question):
        if self.pending_question == question:
            return

        self.pending_question = question
        self.question_asked_at = time.monotonic()
        self.question_reminders = 0

    def _clear_pending_question(self):
        self.pending_question = None
        self.question_asked_at = 0.0
        self.question_reminders = 0

    def _question_options(self):
        return {
            "ready": [
                {"label": "I'm ready", "value": "ready"},
                {"label": "Wait", "value": "wait"},
                {"label": "Need help", "value": "help"},
            ],
            "next_step": [
                {"label": "Next step", "value": "next step"},
                {"label": "Repeat step", "value": "no, repeat step"},
                {"label": "Wait", "value": "wait"},
            ],
            "practice": [
                {"label": "Practice", "value": "practice mode"},
                {"label": "Keep training", "value": "no, continue training"},
                {"label": "Need help", "value": "help"},
            ],
            "session_complete": [
                {"label": "Practice", "value": "practice mode"},
                {"label": "Train again", "value": "train again"},
                {"label": "Finish", "value": "finish session"},
            ],
        }.get(self.pending_question, [])

    def _question_option_labels(self):
        return [option["label"] for option in self._question_options()]

    def _question_payload(self):
        if not self.pending_question:
            return None

        return {
            "kind": self.pending_question,
            "options": self._question_options(),
            "reminders": self.question_reminders,
        }

    def _question_reminder_due(self):
        return bool(
            self.pending_question
            and self.question_reminders < 1
            and self.question_asked_at
            and time.monotonic() - self.question_asked_at >= QUESTION_REMINDER_SECONDS
        )

    def _waiting_for_answer_event(self, accuracy=0, analysis=None, issue="waiting"):
        waiting_messages = {
            "ready": "Are you ready to begin?",
            "next_step": "Would you like the next step or repeat this one?",
            "practice": "Would you like focused practice or keep training?",
            "session_complete": "Choose practice, train again, or finish.",
        }
        reminder_messages = {
            "ready": "Take your time. Choose I'm ready, Wait, or Need help.",
            "next_step": "Choose Next step, Repeat step, or Wait.",
            "practice": "Choose Practice, Keep training, or Need help.",
            "session_complete": "Choose Practice, Train again, or Finish.",
        }
        reminder = self._question_reminder_due()
        if reminder:
            self.question_reminders += 1
            self.question_asked_at = time.monotonic()

        return self.panel_event(
            (reminder_messages if reminder else waiting_messages).get(
                self.pending_question,
                "I am waiting for your answer."
            ),
            accuracy=accuracy,
            action="attention_prompt" if reminder else "waiting",
            analysis=analysis,
            issue=issue,
            speak=reminder,
        )

    def _feedback_intent(self, action, body_part=None, issue=None):
        if self.pending_question:
            suffix = ":reminder" if action == "attention_prompt" else ""
            return f"question:{self.pending_question}{suffix}"

        if action in {"correct", "hold_good", "confirm_correct", "confirm_incorrect"}:
            return f"correction:{body_part or self.active_body_part or 'whole_form'}:{issue or self.active_issue or 'general'}"

        return f"{self.state}:{action}"

    def _complete_step_event(self, step_key, accuracy, analysis):
        self.completed_steps.add(str(step_key))
        self.state = "confirm_step_complete"

        if self._is_final_step():
            self.is_paused = True
            self._set_pending_question("session_complete")
            self.state = "confirm_session_complete"
            message = "Session complete. Practice, train again, or finish?"
            return self.panel_event(
                message,
                accuracy=accuracy,
                action="session_complete_prompt",
                analysis=analysis,
                issue="complete",
                speak=self._should_speak(message)
            )

        self.is_paused = True
        self._set_pending_question("next_step")
        message = "Good work. Are you ready to move to the next step?"
        return self.panel_event(
            message,
            accuracy=accuracy,
            action="confirm_next",
            analysis=analysis,
            issue="complete",
            speak=self._should_speak(message)
        )

    def _is_final_step(self):
        return self.total_steps > 0 and self.current_step_index >= self.total_steps - 1

    def _next_step_index(self):
        if self.total_steps <= 0:
            return self.current_step_index + 1

        return min(self.current_step_index + 1, self.total_steps - 1)

    def _intelligence_message(
        self,
        situation_state,
        feedback_decision,
        attention_target,
        next_action,
        temporal_layers,
    ):
        frontend_message = (feedback_decision.get("message") or "").strip()
        if frontend_message and situation_state not in {"correcting", "warning"}:
            return frontend_message

        focus_target = self._best_short_term_focus(attention_target)
        body_part_key = focus_target.get("body_part") or "form"
        issue_key = focus_target.get("issue") or "needs_attention"
        body_part = body_part_key.replace("_", " ")
        issue = issue_key.replace("_", " ")

        if situation_state == "tracking_unclear":
            return "Tracking is unclear. Step fully into camera view."
        if situation_state == "warning":
            return "Slow this rep down. Reset your guard, then continue."
        if situation_state == "correcting":
            user_layer = temporal_layers.get("level4_user", {})
            session_layer = temporal_layers.get("level3_session", {})
            speed = (user_layer.get("personalization") or {}).get("recommended_speed")
            repeated = (user_layer.get("top_weakness") or {}).get("body_part") == body_part_key
            pacing = "Slowly, " if speed == "slow" or (session_layer.get("fatigue_risk") or 0) > 0.55 else ""

            if body_part_key.startswith("fist_"):
                side = "left" if body_part_key.endswith("left") else "right"
                return f"{pacing}tighten your {side} fist and keep it beside your guard."
            if body_part_key.startswith("hand_"):
                side = "left" if "left" in body_part_key else "right"
                return f"{pacing}show your {side} hand clearly, then hold your guard."
            if "shoulder" in body_part_key:
                side = "left" if "left" in body_part_key else "right"
                if issue_key == "too_open":
                    return f"{pacing}close your {side} shoulder. Keep the elbow near the ribs."
                if issue_key == "too_closed":
                    return f"{pacing}open your {side} shoulder a little, then freeze the guard."
            if self._is_face_readiness_target(body_part_key):
                return "Keep your face forward, but fix the guard first."

            suffix = " This is your repeated pattern." if repeated else ""
            return f"{pacing}fix your {body_part}: {issue}.{suffix}"
        if situation_state == "advance_ready" or next_action.get("allow_next_step"):
            return "Good control. Hold it steady, then move to the next step."
        if situation_state == "encouraging":
            return "Good correction. Keep the same rhythm."
        return "Observing your movement."

    def _best_short_term_focus(self, attention_target):
        if not self._is_face_readiness_target(attention_target.get("body_part")):
            return attention_target

        for context in reversed(self.recent_intelligence_contexts[-5:]):
            target = context.get("attention_target") or {}
            body_part = target.get("body_part")
            if body_part and not self._is_face_readiness_target(body_part):
                return target

        return attention_target

    def _coach_action_from_intelligence(self, situation_state, next_action):
        command = next_action.get("command")
        if command in {"advance_step", "unlock_next_technique"}:
            return "advance_step"
        if command == "fix_tracking":
            return "ask_focus"
        if command == "slow_down":
            return "fatigue_warning"
        if command == "repeat_step" or situation_state == "correcting":
            return "correct"
        return "observe"

    def _update_attention_memory(self, analysis):
        missing_count = sum(
            1 for item in analysis
            if item["issue"] == "missing" and not self._is_readiness_target(item["body_part"])
        )

        if missing_count:
            self.missing_pose_frames += 1
            self.attention_score = max(0, self.attention_score - (missing_count * 8))
        else:
            self.missing_pose_frames = 0
            self.attention_score = min(100, self.attention_score + 2)

    def _update_plateau_memory(self, accuracy):
        if accuracy <= self.last_accuracy + 3:
            self.plateau_frames += 1
        else:
            self.plateau_frames = 0

        self.last_accuracy = accuracy

    def _should_offer_practice(self):
        return (
            not self.practice_suggested
            and self.correction_frames >= 32
            and (self.plateau_frames >= 18 or self.attention_score < 35)
        )

    def _can_complete_step(self, accuracy, readiness_issues):
        return accuracy >= ACCURACY_TO_ADVANCE and not self._blocking_readiness_issues(readiness_issues)

    def _blocking_readiness_issues(self, readiness_issues):
        return [
            item for item in readiness_issues
            if not self._is_face_readiness_target(item["body_part"])
        ]

    def _clear_high_accuracy_hold(self):
        self.high_accuracy_started_at = None
        self.high_accuracy_last_prompt_second = None

    def _sustained_accuracy_event(self, step_key, accuracy, readiness_issues, analysis):
        if not self._can_complete_step(accuracy, readiness_issues):
            self._clear_high_accuracy_hold()
            return None

        now = time.monotonic()
        if self.high_accuracy_started_at is None:
            self.high_accuracy_started_at = now
            self.high_accuracy_last_prompt_second = None

        held_seconds = now - self.high_accuracy_started_at
        if held_seconds >= ACCURACY_HOLD_SECONDS:
            self.active_body_part = None
            self.active_issue = None
            self._clear_high_accuracy_hold()
            self._reset_temporal_focus(keep_ready=True)
            return self._complete_step_event(step_key, accuracy, analysis)

        remaining_seconds = max(1, int(ACCURACY_HOLD_SECONDS - held_seconds + 0.999))
        if self.high_accuracy_last_prompt_second == remaining_seconds:
            return self.panel_event(
                f"Good. Hold this shape {remaining_seconds} more seconds.",
                accuracy=accuracy,
                action="hold_good",
                analysis=analysis,
                issue="hold_good",
                speak=False
            )

        self.high_accuracy_last_prompt_second = remaining_seconds
        message = (
            "Good. Hold this shape for five seconds."
            if held_seconds < 0.8
            else f"Good. Hold this shape {remaining_seconds} more seconds."
        )
        return self.panel_event(
            message,
            accuracy=accuracy,
            action="hold_good",
            analysis=analysis,
            issue="hold_good",
            speak=self._should_speak(message)
        )

    def _reset_temporal_focus(self, keep_ready=False):
        self.active_body_part = None
        self.active_issue = None
        self.correction_frames = 0
        self.missing_pose_frames = 0
        self.plateau_frames = 0
        self.practice_suggested = False
        self._clear_pending_question()
        self.body_part_trends = {}
        self.last_spoken_corrections = {}
        self.pending_speech_focus = None
        self._clear_high_accuracy_hold()
        if not keep_ready:
            self.is_ready = True
            self.readiness_prompted = False

    def _active_issue_item(self, analysis):
        if not self.active_body_part:
            return None

        return next(
            (item for item in analysis if item["body_part"] == self.active_body_part),
            None
        )

    def _active_label(self):
        if not self.active_body_part:
            return "current focus"

        return _body_part_label(self.active_body_part)

    def _sentence_label(self, label):
        return label[:1].upper() + label[1:]

    def _focused_cue(self, item):
        label = item["label"]
        cue = item.get("cue")

        if item["issue"] == "missing":
            return item.get("cue") or f"Bring your {label} into view."

        body_part = item["body_part"]
        if body_part.startswith("fist_"):
            side = "left" if body_part.endswith("left") else "right"
            if item["issue"] in {"too_open", "too_closed"}:
                return f"Tighten your {side} fist and keep it beside your guard."

        if body_part.startswith("hand_"):
            side = "left" if "left" in body_part else "right"
            return f"Show your {side} hand clearly, then hold your guard."

        if self._is_face_readiness_target(body_part):
            return "Keep your face forward. Eyes on the target."

        if item["issue"] in {"too_closed", "too_open"} and cue:
            return cue

        return cue or f"Hold your {label} steady."

    def _is_readiness_target(self, body_part):
        return body_part in READINESS_TARGETS

    def _is_face_readiness_target(self, body_part):
        return body_part in FACE_READINESS_TARGETS

    def _is_hand_readiness_target(self, body_part):
        return body_part in HAND_READINESS_TARGETS

    def _readiness_priority(self, body_part):
        order = {
            "fist_left": 0,
            "hand_left_open": 0,
            "fist_right": 1,
            "hand_right_open": 1,
            "face_forward": 8,
            "eyes_forward": 9,
            "face_calm": 10,
        }

        return order.get(body_part, 99)

    def _ordered_focus_issues(self, readiness_issues, body_issues):
        hand_issues = [
            item for item in readiness_issues
            if self._is_hand_readiness_target(item["body_part"])
        ]
        face_issues = [
            item for item in readiness_issues
            if self._is_face_readiness_target(item["body_part"])
        ]

        sorted_face_issues = sorted(
            face_issues,
            key=lambda entry: self._readiness_priority(entry["body_part"])
        )
        sorted_hand_issues = sorted(
            hand_issues,
            key=lambda entry: self._readiness_priority(entry["body_part"])
        )

        return sorted_face_issues or sorted_hand_issues or body_issues

    def _should_speak(self, message):
        focus = self.pending_speech_focus
        now = time.monotonic()

        if message == self.last_spoken_message and (
            not focus or focus.get("kind") != "steady"
        ):
            return False

        if (
            self.last_spoken_at
            and now - self.last_spoken_at < VOICE_FEEDBACK_COOLDOWN_SECONDS
            and not self._is_priority_voice_message(message)
        ):
            return False

        if focus:
            body_part = focus["body_part"]
            delta = focus["delta"]
            kind = focus["kind"]
            previous_spoken_delta = self.last_spoken_corrections.get(body_part)

            should_speak = (
                previous_spoken_delta is None
                or kind in {"improving", "regressing", "almost", "steady"}
                or abs(delta - previous_spoken_delta) >= 5
            )

            if not should_speak:
                return False

            self.last_spoken_corrections[body_part] = delta

        self.last_spoken_message = message
        self.last_spoken_at = now
        return True

    def _is_priority_voice_message(self, message):
        normalized = (message or "").lower()
        priority_phrases = {
            "good. next step.",
            "practice or train again?",
            "ready?",
        }
        return normalized in priority_phrases or normalized.startswith("next step")

    def _trend_cue(self, item, force_short=False):
        if item["issue"] == "missing":
            return self._focused_cue(item)

        body_part = item["body_part"]
        label = item["label"]
        spoken_label = f"your {label}"
        sentence_label = f"Your {label}"
        direction = item.get("direction")
        delta = item.get("degree_delta")
        unit = item.get("unit", "degrees")
        unit_label = "points" if unit == "score" else "degrees"
        self.pending_speech_focus = None

        if delta is None:
            return self._focused_cue(item)

        trend = self.body_part_trends.get(body_part)
        self.body_part_trends[body_part] = {
            "delta": delta,
            "direction": direction,
            "issue": item["issue"]
        }

        action = "Increase" if direction == "increase" else "Decrease"
        if unit == "score":
            plain_cue = self._focused_cue(item) if delta <= 25 else (
                f"Improve {spoken_label} by {delta} points."
            )
        else:
            plain_cue = f"{action} {spoken_label} {delta} degrees."
        self.pending_speech_focus = {
            "body_part": body_part,
            "delta": delta,
            "kind": "plain",
        }

        if not trend or trend.get("direction") != direction:
            return plain_cue

        previous_delta = trend.get("delta")
        if previous_delta is None:
            return plain_cue

        improvement = previous_delta - delta
        regression = delta - previous_delta

        if improvement >= TREND_SPEAK_DELTA:
            self.pending_speech_focus["kind"] = "improving"
            if delta <= 3:
                return f"Good. Almost there. You reduced {spoken_label} from {previous_delta} to {delta} {unit_label} off."
            return f"Good correction. You reduced {spoken_label} from {previous_delta} to {delta} {unit_label} off. Keep going slowly."

        if regression >= TREND_SPEAK_DELTA:
            self.pending_speech_focus["kind"] = "regressing"
            return f"Careful. {sentence_label} moved away from target, now {delta} {unit_label} off. Bring it back slowly."

        if force_short:
            self.pending_speech_focus["kind"] = "steady"
            return f"Hold steady. {sentence_label} is {delta} {unit_label} off."

        if delta <= 3:
            self.pending_speech_focus["kind"] = "almost"
            return f"Almost there. Hold {spoken_label} steady."

        return plain_cue


def _part_to_namespace(part):
    if hasattr(part, "body_part"):
        return part

    return SimpleNamespace(
        body_part=part.get("body_part"),
        min_angle=part.get("min", part.get("min_angle")),
        max_angle=part.get("max", part.get("max_angle"))
    )


def _body_part_label(body_part):
    side_names = {"left", "right"}
    pieces = body_part.split("_")

    if len(pieces) == 2 and pieces[1] in side_names:
        return f"{pieces[1]} {pieces[0]}"

    return body_part.replace("_", " ")
