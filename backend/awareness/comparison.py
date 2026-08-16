from typing import Any


def compare_client_backend(
    client_awareness: dict[str, Any],
    backend_awareness: dict[str, Any],
    backend_decision: dict[str, Any],
) -> dict[str, Any]:
    client_state = client_awareness.get("situation_state")
    client_action = client_awareness.get("next_action") or {}
    client_feedback = client_awareness.get("feedback_decision") or {}
    backend_state = backend_awareness.get("situation_state")
    backend_command = backend_decision.get("command")
    state_comparable = bool(client_state and backend_state)
    command_comparable = bool(client_action.get("command") and backend_command)
    return {
        "client": {
            "situation_state": client_state,
            "command": client_action.get("command"),
            "feedback_type": client_feedback.get("type"),
        },
        "backend": {
            "situation_state": backend_state,
            "command": backend_command,
            "feedback_type": (backend_decision.get("feedback") or {}).get("type"),
            "confidence": backend_decision.get("confidence"),
        },
        "agreement": {
            "state": client_state == backend_state if state_comparable else None,
            "command": client_action.get("command") == backend_command if command_comparable else None,
        },
        "comparable": state_comparable or command_comparable,
    }
