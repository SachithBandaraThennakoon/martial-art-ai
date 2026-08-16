from collections import deque
from copy import deepcopy
from threading import RLock
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

    def __init__(self, max_events_per_session: int = 200):
        self._lock = RLock()
        self._snapshots: dict[tuple[int, str], AwarenessSnapshot] = {}
        self._events: dict[tuple[int, str], deque[AwarenessEvent]] = {}
        self._max_events = max(10, max_events_per_session)

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


awareness_store = AwarenessStore()
