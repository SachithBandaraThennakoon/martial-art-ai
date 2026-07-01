from dataclasses import dataclass, field
from types import SimpleNamespace

from agents.movement_agent import analyze_movement


ACCURACY_TO_ADVANCE = 100


@dataclass
class CoachSession:
    technique_name: str = "this technique"
    mode: str = "train"
    current_step_key: str | None = None
    current_step_name: str = "selected step"
    state: str = "confirm_start"
    last_feedback: str = ""
    last_spoken_message: str = ""
    active_body_part: str | None = None
    active_issue: str | None = None
    is_ready: bool = False
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

    def user_message(self, message):
        text = (message or "").strip()
        if not text:
            return self.panel_event(
                "I am listening. Say start, next, practice, or again.",
                action="listening"
            )

        normalized = text.lower()
        self.recent_user_messages = (self.recent_user_messages + [text])[-6:]
        if normalized in {"no", "nope", "no thanks", "not now"}:
            intent = "train" if self.pending_question == "practice" else "not_ready"
        else:
            intent = self._classify_user_intent(normalized)
        self.last_user_intent = intent

        if intent == "practice":
            self.mode = "practice"
            self.state = "practice"
            self.is_paused = False
            self._reset_temporal_focus(keep_ready=False)
            return self.panel_event(
                "Practice mode is ready. Move freely and I will keep the guidance light.",
                action="switch_practice"
            )

        if intent == "repeat":
            self.completed_steps.clear()
            self._reset_temporal_focus()
            self.is_ready = False
            self.state = "explain_step"
            return self.panel_event(
                f"Good. We will train {self.technique_name} again. Take a breath. Are you ready?",
                action="restart"
            )

        if self.pending_question == "practice" and intent in {"ready", "train", "next"}:
            self.is_ready = True
            self.is_paused = False
            self.pending_question = None
            self.state = "observe_pose"
            return self.panel_event(
                f"Good. We keep training. Stay with your {self._active_label()} only.",
                action="observe"
            )

        if intent in {"ready", "train"}:
            self.is_ready = True
            self.is_paused = False
            self.pending_question = None
            self.readiness_prompted = False
            self.state = "observe_pose"
            if self.active_body_part:
                return self.panel_event(
                    f"Good. We keep training. Stay with your {self._active_label()} only.",
                    action="observe"
                )

            return self.panel_event(
                f"Good. We start with {self.current_step_name}. Take your position and hold still.",
                action="observe"
            )

        if intent == "not_ready":
            self.is_ready = False
            self.is_paused = True
            self.pending_question = "ready"
            self.state = "waiting"
            return self.panel_event(
                "No rush. I will wait. Tell me when you are ready.",
                action="wait"
            )

        if intent == "next":
            self.is_ready = True
            self.is_paused = False
            self.pending_question = None
            self.state = "observe_pose"
            return self.panel_event(
                f"Settle into {self.current_step_name}. I will watch one detail at a time.",
                action="observe"
            )

        if intent == "focus_help":
            self.attention_score = max(30, self.attention_score - 10)
            return self.panel_event(
                "Stay with one point only. Listen for the body part I name, fix that, then freeze.",
                action="focus_prompt"
            )

        return self.panel_event(
            "I hear you. Are you ready to continue, or do you want practice mode?",
            action="acknowledge"
        )

    def movement_event(self, step_key, step_name, required_parts, live_angles):
        self.current_step_key = step_key
        self.current_step_name = step_name or self.current_step_name

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

        if self.is_paused and self.pending_question == "practice":
            if accuracy >= ACCURACY_TO_ADVANCE:
                self.is_paused = False
                self.pending_question = None
                self.practice_suggested = False
                self.active_body_part = None
                self.active_issue = None
                self.completed_steps.add(str(step_key))
                self.state = "confirm_step_complete"
                self.last_accuracy = accuracy
                message = f"Good. {self.current_step_name} is clean now. Can we move to the next step?"
                return self.panel_event(
                    message,
                    accuracy=accuracy,
                    action="confirm_next",
                    analysis=analysis,
                    issue="complete",
                    speak=self._should_speak(message)
                )

            return self.panel_event(
                "I am waiting. Say practice to switch mode, or continue to keep training.",
                accuracy=accuracy,
                action="waiting",
                analysis=analysis,
                speak=False
            )

        if self.is_paused or not self.is_ready:
            if not self.readiness_prompted:
                self.readiness_prompted = True
                self.pending_question = "ready"
                return self.panel_event(
                    f"Before we move, are you ready to train {self.current_step_name}?",
                    accuracy=accuracy,
                    action="ask_ready",
                    analysis=analysis
                )

            return self.panel_event(
                "I am waiting for your ready signal.",
                accuracy=accuracy,
                action="waiting",
                analysis=analysis,
                speak=False
            )

        self._update_attention_memory(analysis)
        self._update_plateau_memory(accuracy)

        if accuracy >= ACCURACY_TO_ADVANCE:
            self.active_body_part = None
            self.active_issue = None
            self._reset_temporal_focus(keep_ready=True)
            self.completed_steps.add(str(step_key))
            self.state = "confirm_step_complete"
            message = f"Good. {self.current_step_name} is clean now. Can we move to the next step?"
            return self.panel_event(
                message,
                accuracy=accuracy,
                action="confirm_next",
                analysis=analysis,
                issue="complete",
                speak=self._should_speak(message)
            )

        active_item = self._active_issue_item(analysis)

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

            next_issue = issues[0] if issues else None
            if next_issue:
                self.active_body_part = next_issue["body_part"]
                self.active_issue = next_issue["issue"]
                self.correction_frames = 0
                message = (
                    f"Good. {corrected_label} is fixed. Now {self._focused_cue(next_issue)}"
                )
                body_part = next_issue["body_part"]
                issue_name = next_issue["issue"]
            else:
                message = "Good. Hold the shape. Breathe and keep the guard alive."
                body_part = None
                issue_name = "good"
        else:
            focus = active_item if active_item and active_item["issue"] != "good" else None

            if focus is None and issues:
                focus = issues[0]
                self.active_body_part = focus["body_part"]
                self.active_issue = focus["issue"]
                self.correction_frames = 0

            if focus:
                self.correction_frames += 1
                if self._should_offer_practice():
                    self.practice_suggested = True
                    self.pending_question = "practice"
                    self.is_paused = True
                    message = (
                        f"This part needs slower work. Do you want to switch to practice mode "
                        f"and drill your {focus['label']} without step pressure?"
                    )
                    body_part = focus["body_part"]
                    issue_name = "practice_suggested"
                elif self.correction_frames in {4, 8}:
                    message = (
                        f"Pause. Can you focus only on your {focus['label']} for three seconds?"
                    )
                    body_part = focus["body_part"]
                    issue_name = "focus_check"
                else:
                    message = self._focused_cue(focus)
                    body_part = focus["body_part"]
                    issue_name = focus["issue"]
            else:
                message = "Good. Hold this position. Do not rush the next movement."
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
        self.state = "session_complete"
        return self.panel_event(
            f"{self.technique_name} training is complete. Would you like to train again or switch to practice?",
            action="complete"
        )

    def panel_event(
        self,
        message,
        accuracy=0,
        action="coach",
        analysis=None,
        body_part=None,
        issue=None,
        speak=True
    ):
        return {
            "type": "coach",
            "mode": self.mode,
            "state": self.state,
            "action": action,
            "message": message,
            "feedback": [message],
            "summary": message,
            "accuracy": accuracy,
            "body_part": body_part,
            "issue": issue,
            "speak": speak,
            "focus_body_part": self.active_body_part,
            "analysis": analysis or [],
            "memory": {
                "recent_user_messages": self.recent_user_messages,
                "recent_feedback": self.recent_feedback,
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

    def _classify_user_intent(self, text):
        if any(word in text for word in ["practice", "free mode", "free practice"]):
            return "practice"

        if any(word in text for word in ["again", "restart", "train again", "repeat"]):
            return "repeat"

        if any(word in text for word in ["not ready", "wait", "pause", "stop", "hold on"]):
            return "not_ready"

        if any(word in text for word in ["next", "move on", "continue"]):
            return "next"

        if any(word in text for word in ["keep training", "train", "continue training"]):
            return "train"

        if any(word in text for word in ["yes", "start", "ok", "okay", "ready", "please", "go"]):
            return "ready"

        if any(word in text for word in ["focus", "confused", "hard", "can't", "cannot", "help"]):
            return "focus_help"

        return "unknown"

    def _update_attention_memory(self, analysis):
        missing_count = sum(1 for item in analysis if item["issue"] == "missing")

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
            and self.correction_frames >= 6
            and (self.plateau_frames >= 4 or self.attention_score < 55)
        )

    def _reset_temporal_focus(self, keep_ready=False):
        self.active_body_part = None
        self.active_issue = None
        self.correction_frames = 0
        self.missing_pose_frames = 0
        self.plateau_frames = 0
        self.practice_suggested = False
        self.pending_question = None
        if not keep_ready:
            self.is_ready = False
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

        if item["issue"] == "missing":
            return f"I need to see your {label}. Bring it into the camera and hold still."

        if item["issue"] == "too_closed":
            return f"focus only on your {label}. Open it slowly, just a little, then hold."

        if item["issue"] == "too_open":
            return f"focus only on your {label}. Close it slowly, keep the rest quiet."

        return f"keep your {label} exactly there."

    def _should_speak(self, message):
        if message == self.last_spoken_message:
            return False

        self.last_spoken_message = message
        return True


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
