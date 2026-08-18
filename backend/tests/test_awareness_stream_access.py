import asyncio
import json
from types import SimpleNamespace

from fastapi import WebSocketDisconnect

from routers import awareness


class _SessionContext:
    def __enter__(self):
        return object()

    def __exit__(self, *_args):
        return False


class _Socket:
    def __init__(self):
        self.accepted = False
        self.closed = None
        self.sent = []
        self.messages = [json.dumps({"type": "authenticate", "token": "user-token"})]

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        if self.messages:
            return self.messages.pop(0)
        raise WebSocketDisconnect()

    async def send_json(self, value):
        self.sent.append(value)

    async def close(self, code):
        self.closed = code


def test_authenticated_user_can_enter_user_awareness_stream(monkeypatch):
    monkeypatch.setattr(awareness, "SessionLocal", _SessionContext)
    monkeypatch.setattr(
        awareness,
        "get_user_from_token",
        lambda _db, _token: SimpleNamespace(id=7, role="user"),
    )
    socket = _Socket()

    asyncio.run(awareness._run_awareness_stream(socket, admin_only=False))

    assert socket.accepted is True
    assert socket.closed is None
    assert socket.sent[0]["type"] == "authenticated"


def test_non_admin_remains_blocked_from_admin_awareness_stream(monkeypatch):
    monkeypatch.setattr(awareness, "SessionLocal", _SessionContext)
    monkeypatch.setattr(
        awareness,
        "get_user_from_token",
        lambda _db, _token: SimpleNamespace(id=7, role="user"),
    )
    socket = _Socket()

    asyncio.run(awareness._run_awareness_stream(socket, admin_only=True))

    assert socket.closed == 4403
    assert socket.sent[0] == {"type": "error", "code": "admin_required"}
