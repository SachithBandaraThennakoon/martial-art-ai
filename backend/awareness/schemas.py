from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TemporalState(BaseModel):
    """L1-L4 state for an object or relationship.

    Payloads remain extensible while individual detectors and classifiers mature.
    """

    model_config = ConfigDict(extra="allow")

    l1: dict[str, Any] = Field(default_factory=dict)
    l2: dict[str, Any] = Field(default_factory=dict)
    l3: dict[str, Any] = Field(default_factory=dict)
    l4: dict[str, Any] = Field(default_factory=dict)


class WorldObject(BaseModel):
    object_id: str = Field(min_length=1, max_length=96)
    object_type: str = Field(min_length=1, max_length=48)
    source: str = Field(default="unknown", max_length=64)
    confidence: float = Field(default=0, ge=0, le=1)
    verified: bool = False
    observed_at: datetime = Field(default_factory=utc_now)
    state: TemporalState = Field(default_factory=TemporalState)
    attributes: dict[str, Any] = Field(default_factory=dict)


class WorldRelationship(BaseModel):
    relationship_id: str = Field(min_length=1, max_length=160)
    source_id: str = Field(min_length=1, max_length=96)
    target_id: str = Field(min_length=1, max_length=96)
    relationship_type: str = Field(min_length=1, max_length=64)
    confidence: float = Field(default=0, ge=0, le=1)
    verified: bool = False
    state: TemporalState = Field(default_factory=TemporalState)


class AwarenessSnapshotInput(BaseModel):
    schema_version: Literal["awareness/v1"] = "awareness/v1"
    session_key: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    sequence: int = Field(default=0, ge=0)
    captured_at: datetime = Field(default_factory=utc_now)
    goal: dict[str, Any] = Field(default_factory=dict)
    objects: list[WorldObject] = Field(default_factory=list, max_length=64)
    relationships: list[WorldRelationship] = Field(default_factory=list, max_length=256)
    attention: dict[str, Any] = Field(default_factory=dict)
    awareness: dict[str, Any] = Field(default_factory=dict)
    prediction: dict[str, Any] = Field(default_factory=dict)
    reasoning: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("objects")
    @classmethod
    def unique_object_ids(cls, value: list[WorldObject]) -> list[WorldObject]:
        identifiers = [item.object_id for item in value]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("object_id values must be unique within a snapshot")
        return value

    @field_validator("relationships")
    @classmethod
    def valid_relationship_endpoints(
        cls, value: list[WorldRelationship], info
    ) -> list[WorldRelationship]:
        object_ids = {item.object_id for item in info.data.get("objects", [])}
        for relation in value:
            if relation.source_id not in object_ids or relation.target_id not in object_ids:
                raise ValueError("relationship endpoints must reference snapshot objects")
        return value


class AwarenessSnapshot(AwarenessSnapshotInput):
    revision: int = Field(ge=1)
    owner_user_id: int
    received_at: datetime = Field(default_factory=utc_now)


class AwarenessEvent(BaseModel):
    event_id: str
    session_key: str
    revision: int
    event_type: str
    occurred_at: datetime
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class AwarenessSessionSummary(BaseModel):
    session_key: str
    revision: int
    object_count: int
    relationship_count: int
    last_received_at: datetime


class ActionDeliveryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: str = Field(min_length=1, max_length=128)
    channel: str = Field(min_length=1, max_length=32)
    command: str = Field(min_length=1, max_length=64)
    status: Literal["delivered", "unsupported", "rejected", "failed"]
    latency_ms: float = Field(default=0, ge=0, le=60_000)
    detail: dict[str, Any] = Field(default_factory=dict)


class ActionDeliveryBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    deliveries: list[ActionDeliveryItem] = Field(min_length=1, max_length=16)
