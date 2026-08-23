from collections import deque
from copy import deepcopy
import os
from threading import RLock
import time
from uuid import uuid4

from .schemas import (
    AwarenessEvent,
    AwarenessSessionSummary,
    AwarenessSnapshot,
    AwarenessSnapshotInput,
    utc_now,
)


class AwarenessStore:
    """Process-local latest-state store.

    This is intentionally bounded and replaceable. PostgreSQL persistence can be
    added behind the same interface after the streaming contract stabilizes.
    """

    def __init__(
        self,
        max_events_per_session: int = 200,
        checkpoint_interval_seconds: float = 2.0,
        checkpoint_sequence_interval: int = 20,
        max_sessions: int = 256,
    ):
        self._lock = RLock()
        self._snapshots: dict[tuple[int, str], AwarenessSnapshot] = {}
        self._events: dict[tuple[int, str], deque[AwarenessEvent]] = {}
        self._max_events = max(10, max_events_per_session)
        self._max_sessions = max(1, int(max_sessions))
        self._checkpoint_interval = max(0.1, float(checkpoint_interval_seconds))
        self._checkpoint_sequence_interval = max(1, int(checkpoint_sequence_interval))
        self._checkpoint_state: dict[tuple[int, str], tuple[float, int, tuple]] = {}
        self._memory_cache: dict[int, tuple[float, dict, dict]] = {}
        self._memory_cache_ttl = max(30.0, float(os.getenv("AWARENESS_MEMORY_CACHE_TTL_SECONDS", "300")))

    def ingest(self, owner_user_id: int, payload: AwarenessSnapshotInput) -> AwarenessSnapshot:
        with self._lock:
            store_key = (owner_user_id, payload.session_key)
            previous = self._snapshots.get(store_key)
            if previous and payload.sequence < previous.sequence:
                return deepcopy(previous)

            revision = (previous.revision if previous else 0) + 1
            snapshot = AwarenessSnapshot(
                **payload.model_dump(),
                revision=revision,
                owner_user_id=owner_user_id,
                received_at=utc_now(),
            )
            if previous is None and len(self._snapshots) >= self._max_sessions:
                oldest_key = min(
                    self._snapshots,
                    key=lambda key: self._snapshots[key].received_at,
                )
                self._snapshots.pop(oldest_key, None)
                self._events.pop(oldest_key, None)
                self._checkpoint_state.pop(oldest_key, None)
            self._snapshots[store_key] = snapshot
            events = self._events.setdefault(
                store_key, deque(maxlen=self._max_events)
            )
            verified = [item for item in snapshot.objects if item.verified]
            state = str(snapshot.awareness.get("situation_state") or "observing").replace("_", " ")
            events.appendleft(
                AwarenessEvent(
                    event_id=uuid4().hex,
                    session_key=payload.session_key,
                    revision=revision,
                    event_type="world_snapshot",
                    occurred_at=snapshot.received_at,
                    summary=f"{len(verified)} verified objects · {state}",
                    data={
                        "verified_object_ids": [item.object_id for item in verified],
                        "relationship_count": len(snapshot.relationships),
                        "sequence": snapshot.sequence,
                    },
                )
            )
            return deepcopy(snapshot)

    @staticmethod
    def _checkpoint_signature(snapshot: AwarenessSnapshot) -> tuple:
        awareness = snapshot.awareness or {}
        reasoning = snapshot.reasoning or {}
        decision = reasoning.get("backend_decision") or {}
        return (
            awareness.get("situation_state"),
            decision.get("command"),
            (decision.get("feedback") or {}).get("type"),
            tuple(sorted(item.object_id for item in snapshot.objects if item.verified)),
        )

    def should_checkpoint(self, snapshot: AwarenessSnapshot) -> bool:
        """Return whether the hot state should be flushed to durable storage."""
        with self._lock:
            key = (snapshot.owner_user_id, snapshot.session_key)
            previous = self._checkpoint_state.get(key)
            signature = self._checkpoint_signature(snapshot)
            if previous is None:
                return True
            checkpointed_at, checkpointed_sequence, checkpointed_signature = previous
            return (
                signature != checkpointed_signature
                or snapshot.sequence - checkpointed_sequence >= self._checkpoint_sequence_interval
                or time.monotonic() - checkpointed_at >= self._checkpoint_interval
            )

    def mark_checkpoint(self, snapshot: AwarenessSnapshot) -> None:
        with self._lock:
            self._checkpoint_state[(snapshot.owner_user_id, snapshot.session_key)] = (
                time.monotonic(), snapshot.sequence, self._checkpoint_signature(snapshot)
            )

    def get_long_term_memory(self, owner_user_id: int) -> tuple[dict, dict] | None:
        with self._lock:
            cached = self._memory_cache.get(owner_user_id)
            if cached is None or time.monotonic() - cached[0] >= self._memory_cache_ttl:
                self._memory_cache.pop(owner_user_id, None)
                return None
            return deepcopy(cached[1]), deepcopy(cached[2])

    def set_long_term_memory(self, owner_user_id: int, objects: dict, relationships: dict) -> None:
        with self._lock:
            self._memory_cache[owner_user_id] = (
                time.monotonic(), deepcopy(objects), deepcopy(relationships)
            )

    def clear_long_term_memory(self, owner_user_id: int) -> None:
        with self._lock:
            self._memory_cache.pop(owner_user_id, None)

    def get_snapshot(self, session_key: str, owner_user_id: int) -> AwarenessSnapshot | None:
        with self._lock:
            snapshot = self._snapshots.get((owner_user_id, session_key))
            if snapshot:
                return deepcopy(snapshot)
            return None

    def get_events(self, session_key: str, owner_user_id: int, limit: int = 50) -> list[AwarenessEvent]:
        with self._lock:
            store_key = (owner_user_id, session_key)
            snapshot = self._snapshots.get(store_key)
            if not snapshot:
                return []
            return deepcopy(list(self._events.get(store_key, ()))[: max(1, min(limit, 200))])

    def list_sessions(self, owner_user_id: int) -> list[AwarenessSessionSummary]:
        with self._lock:
            sessions = [
                AwarenessSessionSummary(
                    session_key=item.session_key,
                    revision=item.revision,
                    object_count=len(item.objects),
                    relationship_count=len(item.relationships),
                    last_received_at=item.received_at,
                )
                for item in self._snapshots.values()
                if item.owner_user_id == owner_user_id
            ]
            return sorted(sessions, key=lambda item: item.last_received_at, reverse=True)

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()
            self._events.clear()
            self._checkpoint_state.clear()
            self._memory_cache.clear()


awareness_store = AwarenessStore(
    checkpoint_interval_seconds=float(os.getenv("AWARENESS_CHECKPOINT_INTERVAL_SECONDS", "2")),
    checkpoint_sequence_interval=int(os.getenv("AWARENESS_CHECKPOINT_SEQUENCE_INTERVAL", "20")),
    max_sessions=int(os.getenv("AWARENESS_MAX_HOT_SESSIONS", "256")),
)
