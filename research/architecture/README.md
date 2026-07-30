# Architecture evidence

Document the implemented Combat Cognition pipeline here:

`input → perception → L1 motion → L2 action/phase → L3 session → L4 user → situation awareness → context packet → reasoning/feedback → memory`

For every component, distinguish:

- implemented and directly observed
- implemented but not yet experimentally evaluated
- planned future extension

Use `component_evidence.template.csv` to connect architectural claims to code,
screenshots, logs, model artifacts, and evaluation results. In particular, verify
the real API call and model/version before describing the reasoning layer as an
operational OpenAI LLM component.
