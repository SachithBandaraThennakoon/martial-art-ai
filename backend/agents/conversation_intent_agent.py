import re
from dataclasses import dataclass


@dataclass(frozen=True)
class IntentResult:
    name: str
    confidence: float


class ConversationIntentAgent:
    """Context-aware intent routing for short Studio coaching replies."""

    _PHRASES = {
        "practice": ("practice", "practice mode", "free practice", "drill it"),
        "repeat": ("again", "repeat", "restart", "start over", "reset", "one more time"),
        "not_ready": ("not ready", "wait", "pause", "hold on", "give me a moment"),
        "next": ("next", "next step", "move on", "skip", "go ahead"),
        "train": ("keep training", "training mode", "train mode", "continue training", "continue"),
        "ready": ("ready", "start", "begin", "let's go", "lets go", "go"),
        "focus_help": ("help", "show me", "explain", "confused", "too hard", "cannot", "can't"),
        "check_correct": ("is this correct", "am i correct", "is this right", "check me", "how is this"),
        "finish": ("finish session", "end session", "i'm done", "im done", "stop training", "quit"),
    }
    _YES = {"yes", "yeah", "yep", "sure", "ok", "okay", "please", "do it"}
    _NO = {"no", "nope", "not now", "no thanks", "don't", "dont"}

    def classify(self, message, pending_question=None):
        text = self._normalize(message)
        if not text:
            return IntentResult("unknown", 0.0)

        if self._matches_any(text, self._NO):
            return IntentResult(self._decline_intent(pending_question), 0.98)
        if self._matches_any(text, self._YES):
            return IntentResult(self._affirm_intent(pending_question), 0.98)

        for intent in (
            "finish", "practice", "repeat", "not_ready", "focus_help",
            "check_correct", "next", "train", "ready",
        ):
            if self._matches_any(text, self._PHRASES[intent]):
                return IntentResult(self._contextualize(intent, pending_question), 0.9)

        return IntentResult("unknown", 0.2)

    def _affirm_intent(self, pending_question):
        return {
            "next_step": "next",
            "practice": "practice",
            "session_complete": "repeat",
        }.get(pending_question, "ready")

    def _decline_intent(self, pending_question):
        return {
            "practice": "train",
            "next_step": "repeat_step",
            "session_complete": "finish",
        }.get(pending_question, "not_ready")

    def _contextualize(self, intent, pending_question):
        if intent in {"train", "ready"} and pending_question == "next_step":
            return "next"
        return intent

    def _normalize(self, message):
        cleaned = re.sub(r"[^a-z0-9' ]+", " ", str(message).lower())
        return re.sub(r"\s+", " ", cleaned).strip()

    def _matches_any(self, text, phrases):
        return any(
            re.search(rf"(?:^|\s){re.escape(phrase)}(?:$|\s)", text)
            for phrase in phrases
        )
