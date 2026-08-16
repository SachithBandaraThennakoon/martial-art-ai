import os
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .schemas import AwarenessSnapshotInput, TemporalState, WorldObject, utc_now


class HumanObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observation_id: str = Field(default="user:primary", max_length=96)
    confidence: float = Field(ge=0, le=1)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    position: list[float] | None = Field(default=None, min_length=2, max_length=3)
    l1: dict[str, Any] = Field(default_factory=dict)
    l2: dict[str, Any] = Field(default_factory=dict)
    l3: dict[str, Any] = Field(default_factory=dict)
    l4: dict[str, Any] = Field(default_factory=dict)


class ObjectDetection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detection_id: str = Field(min_length=1, max_length=96)
    object_type: str = Field(min_length=1, max_length=48)
    confidence: float = Field(ge=0, le=1)
    bbox: list[float] = Field(min_length=4, max_length=4)
    position: list[float] | None = Field(default=None, min_length=2, max_length=3)
    velocity: list[float] | None = Field(default=None, min_length=2, max_length=3)
    attributes: dict[str, Any] = Field(default_factory=dict)


class SurfaceObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    surface_id: str = Field(min_length=1, max_length=96)
    surface_type: str = Field(pattern=r"^(floor|wall)$")
    confidence: float = Field(ge=0, le=1)
    plane: list[float] | None = Field(default=None, min_length=3, max_length=4)
    boundary: list[list[float]] = Field(default_factory=list, max_length=64)
    attributes: dict[str, Any] = Field(default_factory=dict)


class GeometryObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(default="geometry-adapter", max_length=64)
    confidence: float = Field(default=0, ge=0, le=1)
    positions: dict[str, list[float]] = Field(default_factory=dict)
    ground_plane: list[float] | None = Field(default=None, min_length=3, max_length=4)
    scale_estimate: float | None = Field(default=None, gt=0)


class PerceptionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = Field(default="perception/v1", pattern=r"^perception/v1$")
    session_key: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    sequence: int = Field(ge=0)
    captured_at: datetime = Field(default_factory=utc_now)
    goal: dict[str, Any] = Field(default_factory=dict)
    human: HumanObservation | None = None
    objects: list[ObjectDetection] = Field(default_factory=list, max_length=64)
    surfaces: list[SurfaceObservation] = Field(default_factory=list, max_length=16)
    geometry: GeometryObservation | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def perception_module_status() -> list[dict[str, Any]]:
    specifications = [
        ("human", "MediaPipe", "MEDIAPIPE_ENABLED", None),
        ("objects", "YOLO / external detector", "OBJECT_DETECTOR_ENABLED", "OBJECT_DETECTOR_MODEL_PATH"),
        ("scene", "Semantic segmentation adapter", "SCENE_SEGMENTATION_ENABLED", "SCENE_SEGMENTATION_MODEL_PATH"),
        ("geometry", "Depth / geometry adapter", "DEPTH_GEOMETRY_ENABLED", "DEPTH_GEOMETRY_MODEL_PATH"),
    ]
    results = []
    for key, label, enabled_env, path_env in specifications:
        enabled = os.getenv(enabled_env, "true" if key == "human" else "false").lower() in {"1", "true", "yes"}
        configured_path = os.getenv(path_env, "").strip() if path_env else ""
        model_present = bool(configured_path and Path(configured_path).is_file()) if path_env else enabled
        results.append({
            "key": key,
            "label": label,
            "enabled": enabled,
            "configured": enabled and model_present,
            "model_path_configured": bool(configured_path),
            "status": "ready" if enabled and model_present else "disabled" if not enabled else "model_missing",
        })
    return results


class PerceptionFusionEngine:
    def __init__(self, verification_threshold: float = .5):
        self.verification_threshold = verification_threshold

    def fuse(self, envelope: PerceptionEnvelope) -> AwarenessSnapshotInput:
        world_objects: list[WorldObject] = []
        geometry_positions = envelope.geometry.positions if envelope.geometry else {}
        if envelope.human:
            human = envelope.human
            position = human.position or geometry_positions.get(human.observation_id)
            attributes = {"bbox": human.bbox, "position": position, "perception_source": "human"}
            world_objects.append(WorldObject(
                object_id=human.observation_id,
                object_type="human",
                source="mediapipe",
                confidence=human.confidence,
                verified=human.confidence >= self.verification_threshold,
                observed_at=envelope.captured_at,
                state=TemporalState(l1=human.l1, l2=human.l2, l3=human.l3, l4=human.l4),
                attributes={key: value for key, value in attributes.items() if value is not None},
            ))
        for detection in envelope.objects:
            position = detection.position or geometry_positions.get(detection.detection_id)
            attributes = dict(detection.attributes)
            attributes.update({"bbox": detection.bbox, "perception_source": "object_detector"})
            if position is not None:
                attributes["position"] = position
            l1 = {"velocity": detection.velocity} if detection.velocity is not None else {}
            world_objects.append(WorldObject(
                object_id=f"detection:{detection.detection_id}",
                object_type=detection.object_type.lower(),
                source="object-detector",
                confidence=detection.confidence,
                verified=detection.confidence >= self.verification_threshold,
                observed_at=envelope.captured_at,
                state=TemporalState(l1=l1),
                attributes=attributes,
            ))
        for surface in envelope.surfaces:
            plane = surface.plane
            if surface.surface_type == "floor" and plane is None and envelope.geometry:
                plane = envelope.geometry.ground_plane
            attributes = dict(surface.attributes)
            attributes.update({"plane": plane, "boundary": surface.boundary, "perception_source": "scene"})
            verified = surface.confidence >= self.verification_threshold and bool(plane or surface.boundary)
            world_objects.append(WorldObject(
                object_id=surface.surface_id,
                object_type=surface.surface_type,
                source="scene-segmentation",
                confidence=surface.confidence,
                verified=verified,
                observed_at=envelope.captured_at,
                state=TemporalState(l1={"plane": plane, "surface_state": "observed"} if plane else {}),
                attributes=attributes,
            ))
        metadata = dict(envelope.metadata)
        metadata["perception"] = {
            "schema_version": envelope.schema_version,
            "human_observations": 1 if envelope.human else 0,
            "object_detections": len(envelope.objects),
            "surface_observations": len(envelope.surfaces),
            "geometry_available": envelope.geometry is not None,
            "raw_media_stored": False,
        }
        return AwarenessSnapshotInput(
            session_key=envelope.session_key,
            sequence=envelope.sequence,
            captured_at=envelope.captured_at,
            goal=envelope.goal,
            objects=world_objects,
            metadata=metadata,
        )


perception_fusion_engine = PerceptionFusionEngine()
