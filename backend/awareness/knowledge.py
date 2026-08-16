import json
from pathlib import Path

from pydantic import BaseModel, Field, field_validator


class AwarenessThresholds(BaseModel):
    tracking_min_confidence: float = Field(ge=0, le=1)
    mistake_risk: float = Field(ge=0, le=1)
    action_forecast_trust: float = Field(ge=0, le=1)
    motion_forecast_trust: float = Field(ge=0, le=1)
    relationship_confidence: float = Field(ge=0, le=1)
    hazard_closing_speed: float = Field(ge=0)
    contact_distance: float = Field(ge=0)
    predicted_collision_distance: float = Field(ge=0)


class PredictionHorizons(BaseModel):
    l1_seconds: float = Field(gt=0, le=1)
    l2_seconds: float = Field(gt=0, le=10)
    l3_label: str = Field(min_length=1, max_length=32)


class KnowledgeProfile(BaseModel):
    schema_version: str = Field(pattern=r"^knowledge/v1$")
    profile_id: str = Field(min_length=1, max_length=96)
    version: str = Field(min_length=1, max_length=32)
    thresholds: AwarenessThresholds
    horizons: PredictionHorizons
    goal_weights: dict[str, dict[str, float]]
    domains: dict[str, list[str]] = Field(default_factory=dict)
    utility_weights: dict[str, float] = Field(default_factory=lambda: {
        "defense": 1.0, "balance": .75, "power": .35, "mobility": .65,
        "exposure": -1.0, "joint_stress": -.8, "energy_waste": -.45,
    })

    @field_validator("goal_weights")
    @classmethod
    def validate_goal_weights(cls, value):
        if "improve_user_technique" not in value:
            raise ValueError("improve_user_technique goal weights are required")
        for goal, weights in value.items():
            if not weights:
                raise ValueError(f"goal {goal} must contain object weights")
            if any(weight < 0 or weight > 1 for weight in weights.values()):
                raise ValueError("goal weights must be between 0 and 1")
        return value

    @field_validator("utility_weights")
    @classmethod
    def validate_utility_weights(cls, value):
        required = {"defense", "balance", "power", "mobility", "exposure", "joint_stress", "energy_waste"}
        if set(value) != required:
            raise ValueError("utility weights must define the complete bounded decision objective")
        if any(abs(weight) > 10 for weight in value.values()):
            raise ValueError("utility weights must remain between -10 and 10")
        return value


DEFAULT_KNOWLEDGE_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "awareness" / "default.v1.json"
)


def load_knowledge_profile(path: Path = DEFAULT_KNOWLEDGE_PATH) -> KnowledgeProfile:
    return KnowledgeProfile.model_validate(json.loads(path.read_text(encoding="utf-8")))


DEFAULT_KNOWLEDGE = load_knowledge_profile()
