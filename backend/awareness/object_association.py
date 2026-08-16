from dataclasses import dataclass
from math import dist
from threading import RLock
from uuid import uuid4

from .schemas import WorldObject


def _point(item: WorldObject) -> tuple[float, ...] | None:
    position = item.attributes.get("position") or item.state.l1.get("position")
    if isinstance(position, (list, tuple)) and len(position) >= 2:
        try:
            return tuple(float(value) for value in position[:3])
        except (TypeError, ValueError):
            return None
    bbox = item.attributes.get("bbox")
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        try:
            x, y, width, height = (float(value) for value in bbox[:4])
            return (x + width / 2, y + height / 2)
        except (TypeError, ValueError):
            return None
    return None


def _temporary_id(identifier: str) -> bool:
    lowered = identifier.lower()
    return lowered.startswith(("detection:", "temp:", "unknown:"))


@dataclass
class Track:
    object_id: str
    object_type: str
    source: str
    point: tuple[float, ...] | None
    last_sequence: int
    observations: int = 1


class ObjectAssociationEngine:
    """Associates detector observations with stable per-session object IDs."""

    def __init__(self, distance_threshold: float = 0.25, max_idle_frames: int = 30):
        self.distance_threshold = max(0.01, distance_threshold)
        self.max_idle_frames = max(1, max_idle_frames)
        self._lock = RLock()
        self._sessions: dict[tuple[int, str], dict[str, Track]] = {}

    def associate(
        self,
        owner_user_id: int,
        session_key: str,
        sequence: int,
        observations: list[WorldObject],
    ) -> list[WorldObject]:
        key = (owner_user_id, session_key)
        with self._lock:
            tracks = self._sessions.setdefault(key, {})
            active_ids: set[str] = set()
            associated: list[WorldObject] = []
            for observation in observations:
                location = _point(observation)
                track = tracks.get(observation.object_id)
                association_method = "provided_id" if track else "new"

                if track is None and _temporary_id(observation.object_id):
                    candidates = [
                        candidate for candidate in tracks.values()
                        if candidate.object_type == observation.object_type
                        and candidate.source == observation.source
                        and candidate.object_id not in active_ids
                        and candidate.point is not None
                        and location is not None
                        and len(candidate.point) == len(location)
                    ]
                    if candidates:
                        nearest = min(candidates, key=lambda candidate: dist(candidate.point, location))
                        if dist(nearest.point, location) <= self.distance_threshold:
                            track = nearest
                            association_method = "nearest_position"

                if track is None:
                    canonical_id = (
                        f"{observation.object_type}:{uuid4().hex[:12]}"
                        if _temporary_id(observation.object_id)
                        else observation.object_id
                    )
                    track = Track(
                        object_id=canonical_id,
                        object_type=observation.object_type,
                        source=observation.source,
                        point=location,
                        last_sequence=sequence,
                    )
                    tracks[canonical_id] = track
                else:
                    track.point = location or track.point
                    track.last_sequence = sequence
                    track.observations += 1

                active_ids.add(track.object_id)
                attributes = dict(observation.attributes)
                attributes["tracking"] = {
                    "canonical_id": track.object_id,
                    "association": association_method,
                    "observations": track.observations,
                    "last_sequence": sequence,
                }
                associated.append(observation.model_copy(update={
                    "object_id": track.object_id,
                    "attributes": attributes,
                }))

            stale_ids = [
                identifier for identifier, track in tracks.items()
                if sequence - track.last_sequence > self.max_idle_frames
            ]
            for identifier in stale_ids:
                del tracks[identifier]
            return associated

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()
