# Reasoning implementation audit

Audit date: 2026-07-31  
Scope: checked local `martial-art-ai` repository

## Finding

The current checked implementation does **not** contain an operational OpenAI LLM
call. Its final coaching messages are produced by deterministic Python and
JavaScript decisions/templates.

This does not remove the reasoning contribution. The system has a useful,
model-independent cognition boundary: perception and temporal layers are reduced
to a structured `coach_intelligence_context` packet, situation awareness selects
an attention target and action, and the coaching layer turns that decision into a
user-facing response. An LLM can later replace or augment only the final response
generator while preserving the upstream evidence and safety gates.

## Repository evidence

- `frontend/src/situationAwareness/buildCoachContextPacket.js` constructs the
  context packet from Level 1 motion, Level 2 action/forecast, Level 3 session,
  Level 4 user history, and situation awareness.
- `frontend/src/situationAwareness/SituationAwarenessLayer.js` uses explicit
  thresholds and deterministic feedback types such as tracking prompt, correction,
  fatigue warning, predictive guidance, advance and encouragement.
- `backend/agents/training_coach.py` receives that packet and
  `_intelligence_message()` selects fixed responses according to situation state,
  target, issue, fatigue and personalization.
- `backend/agents/coaching_agent.py` formats angle-based feedback with fixed text.
- `backend/agents/master_orchestrator.py` subclasses `CoachSession`; it does not
  invoke an external reasoning model.
- `backend/requirements.txt` contains no OpenAI SDK dependency.
- Repository search found no OpenAI client, Responses API call, Chat Completions
  call, model identifier or API-key configuration in the operational source.

This audit applies only to the checked repository. If an OpenAI service exists in
another branch, deployment, private service or uncommitted file, that path must be
provided and audited before changing this conclusion.

## Correct thesis wording now

> The implemented prototype uses a deterministic coaching decision and response
> layer over a structured multi-level cognition context. The architecture exposes
> a model-independent reasoning boundary designed to support an external LLM or a
> future locally trained model. LLM-based coaching remains planned work and was not
> included in the reported operational evaluation.

Avoid writing that OpenAI is already evaluated, improves accuracy, or is the
system's operational brain unless later evidence confirms the call path and the
evaluation protocol in this folder has been run.

## Replacement boundary

The future model should receive only the structured packet plus controlled session
history. Its output should conform to a small schema such as:

```json
{
  "action": "correct",
  "message": "Close your left shoulder slightly and keep the elbow near the ribs.",
  "target": "shoulder_left",
  "confidence": 0.82,
  "evidence_refs": ["level2_action.likely_mistake", "level3_session.repeated_mistake"]
}
```

Schema validation and existing safety/priority gates should remain outside the
model. This makes OpenAI and a future local LLM interchangeable and testable.
