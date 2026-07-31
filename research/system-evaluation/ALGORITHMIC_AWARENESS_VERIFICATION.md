# Algorithmic Awareness-Layer Verification

## Status

The deterministic temporal, session-awareness, situation-awareness and
supporting frontend algorithms were verified against the repository's complete
automated frontend test suite.

Result:

```text
Test files executed: 23
Assertions executed: 129
Passed: 129
Failed: 0
Assertion pass rate: 100%
```

Environment:

- date: 31 July 2026;
- Node.js: `v22.19.0`;
- source commit: `c1ae68b540b2bb4c9b70da7ce0c8783a5a9e0aae`; and
- execution method: each `.test.mjs` file executed sequentially with Node.js.

Node's default parallel test runner could not spawn worker processes in the
restricted execution environment (`spawn EPERM`). This was an environment
restriction rather than an assertion failure. Executing the same test files
sequentially in-process produced the result above.

## What this step evaluates

This step evaluates implemented deterministic logic rather than learned-model
accuracy. It verifies that designed inputs and events produce the expected
state transitions, calculations, safety gates and outputs.

The evaluated pipeline includes:

```text
biomechanical and tracking evidence
→ motion/action segmentation
→ ordered phase-state decoder
→ repetition/session ledger
→ Level 3 session cognition
→ forecast trust gates
→ situation-awareness decision
→ feedback reasoning
```

## Level 3 session cognition

Level 3 is a deterministic session-intelligence layer, not a separately trained
machine-learning model. It aggregates recent Level 1 and Level 2 evidence to
calculate:

- mastery score;
- consistency score;
- fatigue risk;
- performance trend;
- repeated mistakes;
- repetition summary;
- session state; and
- recommendations such as continue, repeat, slow down, reset or advance.

The default implementation:

- waits for at least six samples before making a session recommendation;
- retains a rolling window of 36 samples;
- treats mastery of at least 0.72 and consistency of at least 0.68 as part of
  advance readiness;
- uses a fatigue-risk threshold of 0.62;
- requires at least three occurrences to mark a repeated mistake; and
- resets accumulated session evidence when the technique changes.

The Level 3 tests verified that it:

1. waits for a trend before recommending progression;
2. respects a configurable fatigue threshold;
3. clears session evidence when the technique changes;
4. detects a repeated session mistake; and
5. preserves sparse events between normal scoring updates.

All five Level 3 assertions passed.

## Forecast and situation awareness

Forecasts are not trusted automatically. The forecast-awareness layer checks:

- model availability;
- prediction confidence;
- tracking confidence;
- agreement between prediction and observation;
- sufficient forecast frames;
- sustained future violations; and
- minimum risk.

Situation awareness uses a trusted future warning only when these gates are
satisfied. The tests verified that:

- sustained, trusted future angle violations create a warning;
- a forecast that disagrees with observation cannot influence awareness; and
- a trusted future risk produces non-blocking predictive guidance.

This is important to the Level 2 one-second prediction design: ACP-STGAT output
is treated as evidence subject to trust checks, not unquestioned truth.

## Ordered temporal reasoning

The ordered decoder and temporal state-machine tests verified:

- complete Jab cycles;
- fast and slow valid Jabs;
- Front Kick using technique-specific rules;
- rejection of impossible or wrongly ordered movement;
- resistance to one-frame noise;
- tracking-loss reset and recovery;
- guard hysteresis;
- stalled-state timeout and repetition abort; and
- learned phase emissions driving legal transitions.

This confirms that phase probabilities do not directly create repetitions.
They are constrained by deterministic transition, duration and recovery rules.

## Repetition and session processing

The tests verified:

- conversion of temporal events into completed repetitions;
- association between a coaching cue and movement response time;
- preservation of unfinished repetitions as incomplete/aborted;
- duplicate-event suppression;
- correct whole-session boundaries and summaries;
- pause/resume behavior;
- fast sampled Jabs;
- rejection of fast but incorrect movement;
- recovery after brief tracking loss;
- exclusion of irrelevant post-repetition movement;
- post-session repair of small gaps and microstates; and
- rejection of impossible transitions rather than forcing a count.

These algorithmic tests are complementary to the synthetic phase-model result,
which under-counted some multi-repetition Jabs. They show that the deterministic
decoder behaves correctly for the designed fixtures. They do not prove that
real model emissions will always supply sufficient evidence for correct counts.

## Perception and biomechanical evidence

Supporting tests verified:

- camera-scale-normalized motion features;
- punch and kick velocity direction;
- anatomical hand-side assignment;
- safe handling of missing face/hand evidence;
- required-angle scoring;
- visibility and evidence-coverage behavior;
- persistence requirements for form errors;
- resistance to one-frame error noise; and
- ranked, concise and actionable correction feedback.

## Model/runtime contract

Runtime-contract tests verified:

- phase metadata covers every decoder state;
- the deployed shared metadata covers Jab and Front Kick;
- standalone Colab metadata can be normalized to the runtime contract;
- phase logits become normalized probabilities; and
- low-confidence learned evidence cannot override deterministic rules.

## Is this a good result?

Yes. Passing all 129 assertions is strong evidence that the implemented
deterministic algorithms behave as designed for the tested normal, edge and
failure scenarios. It supports the software correctness and internal
integration sections of the report.

It is not correct to call this `100% system accuracy`. A test assertion pass
rate measures agreement with predefined software scenarios. It does not
measure performance on real practitioners, unseen movements, camera noise or
expert ground truth.

## Claims supported by this verification

The report may state that:

1. all 129 automated frontend assertions passed;
2. Level 3 session cognition responded correctly to tested trends, fatigue,
   repeated mistakes and technique changes;
3. forecast trust gates prevented an untrusted prediction from affecting
   awareness;
4. ordered decoders rejected tested noise and impossible transitions;
5. incomplete repetitions and tracking loss were handled explicitly;
6. learned phase evidence remained constrained by deterministic safety rules;
   and
7. the model metadata and runtime probability contract were internally valid.

## Claims not supported by this verification

This result does not establish:

- 100% real-world system accuracy;
- real-human repetition precision or recall;
- correctness of thresholds for every martial artist;
- validity of fatigue as a physiological measurement;
- browser/camera latency;
- usability or coaching effectiveness;
- LLM feedback quality; or
- generalization beyond the implemented techniques and scenarios.

Fatigue risk should be described as a heuristic session-risk indicator based on
movement evidence, not a medical or physiological diagnosis.

## Report-ready verification paragraph

> The deterministic awareness and temporal-reasoning implementation was
> verified using 129 automated assertions distributed across 23 frontend test
> files. All assertions passed. The tests covered biomechanical feature
> extraction, ordered phase transitions, temporal noise rejection, tracking
> loss, incomplete and invalid repetitions, repetition ledgers, session
> summaries, Level 3 mastery and fatigue-risk decisions, forecast trust gates,
> situation-awareness guidance, feedback reasoning and learned-model metadata
> contracts. This result provides software-verification evidence that the
> implemented algorithms behave as designed for the tested scenarios. It is
> not interpreted as 100% real-world accuracy, because the fixtures do not
> represent the full variation of human practitioners and camera conditions.

## Remaining evidence

Live system/pilot evaluation remains intentionally deferred until recordings,
screenshots and practice outputs can be supplied. That final stage will measure
expert-ground-truth correctness, real repetition outcomes, end-to-end latency,
tracking failures, usability and observed failure cases.

