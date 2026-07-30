# End-to-end system evaluation

Evaluate the complete framework after both offline model evaluations and ONNX
parity checks are complete.

## Minimum comparison

- `rule_only`: perception and deterministic/rule feedback
- `hybrid`: perception, temporal models, situation awareness, and reasoning layer

Add `model_only` as an offline diagnostic, not as a user-facing coaching system.
If LLM feedback is operational, compare `hybrid_template` and `hybrid_llm`.

## Primary measures

- task/phase decision correctness against expert ground truth
- feedback correctness, relevance, safety, and actionability
- end-to-end response latency (median and p95)
- tracking failure rate and prediction availability
- repetition/phase-boundary errors
- participant usability ratings and observed failure cases

The three-participant study is a pilot and must not be generalized to all martial
artists. Report individual results as well as descriptive aggregate statistics.
