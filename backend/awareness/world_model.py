from .object_association import ObjectAssociationEngine
from .relationships import L1RelationshipEngine
from .attention import AttentionEngine
from .inference import AwarenessInferenceEngine
from .prediction import MultihorizonPredictionEngine
from .reasoning import DecisionPolicy
from .comparison import compare_client_backend
from .knowledge import DEFAULT_KNOWLEDGE, KnowledgeProfile
from .schemas import AwarenessSnapshotInput
from .temporal import ObjectTemporalEngine
from threading import RLock


class WorldModelEngine:
    def __init__(self, knowledge: KnowledgeProfile = DEFAULT_KNOWLEDGE):
        self.knowledge = knowledge
        self.association = ObjectAssociationEngine()
        self.temporal = ObjectTemporalEngine()
        self.relationships = L1RelationshipEngine(knowledge=knowledge)
        self.attention = AttentionEngine(knowledge)
        self.inference = AwarenessInferenceEngine(knowledge)
        self.prediction = MultihorizonPredictionEngine(knowledge)
        self.reasoning = DecisionPolicy(knowledge)
        self._previous_awareness: dict[tuple[int, str], dict] = {}
        self._lock = RLock()

    def configure(self, knowledge: KnowledgeProfile) -> None:
        if (
            self.knowledge.profile_id == knowledge.profile_id
            and self.knowledge.version == knowledge.version
        ):
            return
        self.knowledge = knowledge
        self.relationships = L1RelationshipEngine(knowledge=knowledge)
        self.attention = AttentionEngine(knowledge)
        self.inference = AwarenessInferenceEngine(knowledge)
        self.prediction = MultihorizonPredictionEngine(knowledge)
        self.reasoning = DecisionPolicy(knowledge)

    def process(
        self, owner_user_id: int, payload: AwarenessSnapshotInput,
        previous_awareness: dict | None = None,
        object_memory: dict[str, dict] | None = None,
        relationship_memory: dict[str, dict] | None = None,
    ) -> AwarenessSnapshotInput:
        objects = self.association.associate(owner_user_id, payload.session_key, payload.sequence, payload.objects)
        object_memory = object_memory or {}
        objects = [item.model_copy(update={"state": item.state.model_copy(update={
            "l4": {**object_memory.get(item.object_id, {}), **item.state.l4}
        })}) for item in objects]
        objects = self.temporal.enrich(owner_user_id, payload.session_key, payload.captured_at, objects)
        canonical_ids = {
            original.object_id: associated.object_id
            for original, associated in zip(payload.objects, objects)
        }
        explicit_relationships = [relation.model_copy(update={
            "source_id": canonical_ids.get(relation.source_id, relation.source_id),
            "target_id": canonical_ids.get(relation.target_id, relation.target_id),
        }) for relation in payload.relationships]
        relationships = self.relationships.build(
            objects, explicit_relationships,
            owner_user_id=owner_user_id, session_key=payload.session_key,
            long_term_memory=relationship_memory,
        )
        attention = self.attention.score(payload.goal, objects, relationships)
        awareness_key = (owner_user_id, payload.session_key)
        with self._lock:
            previous_awareness = previous_awareness or self._previous_awareness.get(awareness_key)
        inferred_awareness = self.inference.infer(objects, relationships, attention, previous_awareness)
        with self._lock:
            self._previous_awareness[awareness_key] = inferred_awareness
        backend_prediction = self.prediction.predict(objects, relationships)
        backend_decision = self.reasoning.decide(
            payload.goal, inferred_awareness, backend_prediction, attention
        )
        comparison = compare_client_backend(payload.awareness, inferred_awareness, backend_decision)
        awareness = dict(payload.awareness)
        awareness["backend_inference"] = inferred_awareness
        awareness.setdefault("situation_state", inferred_awareness["situation_state"])
        prediction = dict(payload.prediction)
        prediction["backend_prediction"] = backend_prediction
        reasoning = dict(payload.reasoning)
        reasoning["backend_decision"] = backend_decision
        client_attention = dict(payload.attention)
        metadata = dict(payload.metadata)
        metadata["world_model"] = {
            "association": "object-association/v1",
            "object_temporal": "object-l1-l4/v1",
            "relationships": "relationship-l1-l4/v1",
            "verified_objects": sum(1 for item in objects if item.verified),
            "verified_relationships": sum(1 for item in relationships if item.verified),
            "inference": "history-goal-attention/v2",
            "prediction": "multiscale-l1-l4/v2",
            "reasoning": "utility-decision-policy/v2",
            "previous_awareness_used": previous_awareness is not None,
            "knowledge": {"profile_id": self.knowledge.profile_id, "version": self.knowledge.version},
        }
        metadata["decision_comparison"] = comparison
        if client_attention:
            metadata["client_attention"] = client_attention
        return payload.model_copy(update={
            "objects": objects,
            "relationships": relationships,
            "attention": attention.as_dict(),
            "awareness": awareness,
            "prediction": prediction,
            "reasoning": reasoning,
            "metadata": metadata,
        })


world_model_engine = WorldModelEngine()
