# Architecture evidence

The implemented Combat Cognition pipeline is documented in
`COMBAT_COGNITION_ARCHITECTURE_AND_EVIDENCE.md`:

`input → perception → L1 motion → L2 action/phase → L3 session → L4 user → situation awareness → context packet → reasoning/feedback → memory`

For every component, distinguish:

- implemented and directly observed
- implemented but not yet experimentally evaluated
- planned future extension

Use `component_evidence.csv` to connect architectural claims to code, screenshots,
logs, model artifacts and evaluation results. Use
`design_knowledge_register.template.csv` to record why each expert-informed design
rule exists and how it is independently checked.

`PRACTITIONER_KNOWLEDGE_METHODOLOGY.md` explains how the researcher's martial-arts
experience, biomechanics, psychology, philosophy and first-person observations can
inform the artifact without being treated as universal human evidence. In
particular, verify a real API call and model/version before describing the reasoning
layer as an operational OpenAI LLM component.
