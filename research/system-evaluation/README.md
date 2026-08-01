# End-to-end system evaluation

The executable design and field instructions are in
`../pilot-study/PILOT_AND_FRAMEWORK_EVALUATION_PROTOCOL.md` and
`../pilot-study/FIELD_RUNBOOK.md`.

The minimum paired comparison is:

- `rule_only`: perception plus deterministic biomechanical/state rules, with
  learned temporal prediction and higher-level awareness disabled by a verified
  configuration;
- `hybrid_template`: perception, temporal models, situation awareness, and the
  current deterministic/template feedback layer.

`model_only` remains an offline diagnostic. `hybrid_llm` is excluded because the
checked repository has no operational LLM call. A label alone is not proof of a
condition: the exported configuration and logs must demonstrate which components
ran. The same recorded input must be replayed in both conditions.

Primary measures are expert-ground-truth phase/form agreement, blinded feedback
quality and safety, end-to-end latency, tracking/prediction availability, failures,
and usability. Results are a single expert case (n=1), not generalizable evidence.

Automated deterministic verification is separately documented in
`ALGORITHMIC_AWARENESS_VERIFICATION.md`; it is software evidence, not live-human
accuracy.
