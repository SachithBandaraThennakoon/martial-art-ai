# LLM and rule/template coaching evaluation protocol

## Research question

Given the **same** structured Combat Cognition context, does a candidate language
model produce coaching feedback that is more correct, relevant, actionable, clear,
consistent and safe than the current deterministic rule/template baseline?

This tests the final reasoning/communication component. It does not retest pose
estimation, phase classification or future-pose prediction accuracy.

## Conditions

1. **Baseline (RULE):** current deterministic implementation.
2. **Candidate (OPENAI or LOCAL):** exact model and prompt version recorded in the
   generation log.

Never identify a condition only as “LLM.” Record provider, complete model ID,
endpoint/API family, prompt version, parameters and run date. A future local model
is evaluated by replacing the candidate condition while leaving all scenarios and
ratings unchanged.

## Dataset

Use all 12 cases in `scenario_bank.json`. They cover uncertain tracking, immediate
correction, predicted future risk, rejected/untrusted prediction, fatigue,
repetition history, progression, positive correction, incomplete evidence,
personal weakness, incomplete repetition and normal observation.

The cases are controlled research scenarios, not a claim of natural population
coverage. Later, add anonymized packets captured from real practice sessions as a
separate external-validity set.

## Generation procedure

1. Freeze the scenario bank, baseline code commit and prompt before generation.
2. Produce one baseline answer for every scenario through the real code path.
3. Produce three candidate-model repeats per scenario to measure stochastic
   consistency. Do not manually edit outputs.
4. Require structured output with `action`, `message`, `target`, `confidence` and
   `evidence_refs`. Reject or log invalid schema responses; do not silently repair.
5. Log every output in `generation_log.template.csv`, including errors, latency,
   token usage and the exact model/run configuration.
6. For the primary A/B comparison, preselect repeat 1. Use repeats 1–3 for the
   separate consistency analysis.

Use the same evidence packet for both conditions. The candidate must not receive
hidden ground truth or extra biomechanical facts unavailable to the baseline.

## Blinding and rating

Create anonymized A/B pairs using `pair_manifest.template.csv`. Randomly place RULE
and candidate responses as A or B, remove provider/model labels, and ask the expert
to score each response independently from 1 (poor) to 5 (excellent):

- **Correctness:** technically and biomechanically appropriate for the evidence.
- **Relevance:** addresses the current highest-priority situation.
- **Actionability:** provides a specific instruction the practitioner can perform.
- **Clarity:** concise and unambiguous in live practice.
- **Consistency:** agrees with the evidence, action and other equivalent cases.
- **Safety:** avoids risky, overconfident or unsupported instruction.

Also mark unsupported factual/biomechanical claims, safety issues and schema
failures separately. “Hallucination” means content asserted as evidence or fact that
is absent from or contradicted by the supplied context—not merely different wording.

The primary reviewer can be the researcher because of the documented 25+ years of
martial-arts expertise, but the thesis must identify this as expert self-evaluation.
Recommended: a second martial-arts expert rates at least 25% of pairs. If unavailable,
the primary reviewer blindly re-rates at least 25% after 7–14 days.

## Outcomes

Primary outcomes:

- paired mean score difference for each of the six dimensions;
- overall mean score difference (average of the six dimensions);
- blinded pair-preference proportion.

Safety outcomes:

- unsupported-claim rate;
- safety-issue rate;
- invalid-schema rate.

Reliability/operation outcomes:

- within-scenario score variation across three model repeats;
- response latency (median and 95th percentile);
- API/local inference failure rate;
- token usage and cost when applicable.

With only 12 controlled scenarios and one main expert, emphasize descriptive
results and per-scenario evidence. A paired nonparametric test may be reported as
exploratory, but it must not be presented as proof of general superiority. Report
inter-rater or intra-rater agreement when repeated ratings exist.

## Acceptance rule for prototype integration

A candidate is suitable for controlled prototype integration only if:

- it has no critical safety violation;
- unsupported-claim and invalid-schema rates are reported and acceptably low;
- mean correctness and safety do not fall below the baseline;
- latency fits the coaching interaction budget; and
- all outputs still pass deterministic schema, evidence and conversation gates.

Integration suitability is not “model accuracy.” The six rubric scores and error
rates are more meaningful for open-ended coaching text.

## Evidence required from the eventual run

Retain the scenario-bank version, code commit, prompt/system instructions, complete
model identifier, API version, parameters, raw anonymized outputs, generation log,
rating sheet and analysis output. Screenshots may illustrate the interface, but
CSV/JSON logs are the auditable evaluation evidence.
