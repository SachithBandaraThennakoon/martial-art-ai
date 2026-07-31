# Reasoning and coaching-feedback evaluation

This folder contains the reproducible evaluation package for the final reasoning
and coaching-output stage of the Combat Cognition Framework.

## Current status

The implementation audit found a structured, replaceable reasoning boundary, but
the checked repository currently generates coaching feedback with deterministic
rules and text templates. No operational OpenAI SDK/API call or OpenAI dependency
was found. Therefore:

- the current implementation is the **rule/template baseline**;
- an OpenAI-backed result must not be claimed yet;
- the same scenario bank and context contract can later evaluate OpenAI or a local
  model without changing the upstream perception and awareness layers.

See [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md) for evidence and reporting
language, and [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md) for the procedure.

## Files

- `scenario_bank.json` — fixed test situations and expert expectations.
- `generation_log.template.csv` — model/version, parameters, latency and output log.
- `pair_manifest.template.csv` — concealed A/B presentation order.
- `ratings.template.csv` — expert rating form.
- `analyze_ratings.py` — dependency-free descriptive analysis.

The researcher's 25+ years of martial-arts expertise is valuable domain-expert
evidence. Self-review bias must still be disclosed. Prefer an independent second
expert for at least a subset; otherwise blindly re-rate a subset after a delay and
report intra-rater agreement.
