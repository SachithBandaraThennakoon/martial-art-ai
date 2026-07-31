# Practitioner knowledge and first-person inquiry methodology

## Methodological position

The artifact can be described as an **expert-informed design-science project with
reflexive practitioner inquiry**. Four evidence sources contribute different roles:

1. **Long-term practitioner expertise** — more than 25 years of martial-arts
   practice, training, cross-style study and research provide expert elicitation
   for movement phases, coaching priorities, common errors and progression logic.
2. **First-person reflective inquiry** — systematic observation of the researcher's
   own perception, timing, anticipation, attention, correction and learning informs
   design hypotheses about the functional loop.
3. **Interdisciplinary knowledge** — martial-arts traditions and study of
   biomechanics, psychology and philosophy provide concepts to compare, refine and
   challenge those hypotheses.
4. **Independent empirical evidence** — landmark data, model experiments, software
   tests, recorded sessions, participant ratings and future sensors test whether
   the computational artifact behaves as intended.

These sources are complementary, not interchangeable.

## What “research inside myself” can mean academically

Use the phrase **structured first-person practitioner observation** or **reflexive
practitioner inquiry**. If a dated diary, protocol and systematic coding are later
maintained, it may support a more formal first-person or autoethnographic component.
Without that record, do not label ordinary memory or intuition as a validated
autoethnographic study.

First-person inquiry can responsibly describe:

- what the researcher notices during practice;
- how attention appears to shift before/during/after an action;
- how anticipation, timing and correction are experienced;
- how expertise suggests decomposing perception–awareness–decision–feedback;
- why particular computational states or feedback priorities were designed.

It cannot by itself establish:

- how the human brain or nervous system objectively operates;
- that every martial artist has the same internal experience;
- clinical, neurological or psychological validity;
- causal biomechanical efficiency or reduced energy expenditure;
- model/system accuracy.

Claims about biological mechanisms require appropriate literature and, where
relevant, physiological or sensor measurements.

## Recommended evidence protocol

For every practitioner-derived rule or architecture decision, complete one row in
`design_knowledge_register.template.csv`:

1. Record the original observation and its date/context.
2. Translate it into a falsifiable design hypothesis.
3. Identify the implemented component, threshold or rule.
4. Record supporting and conflicting literature/data.
5. Define an independent test and acceptance criterion.
6. Record whether the result supports, modifies or rejects the hypothesis.
7. Keep a reflexive note describing possible personal/style bias.

Example:

| Observation | Design hypothesis | Implementation | Independent check |
|---|---|---|---|
| A coach should not correct every visible issue simultaneously. | One prioritized cue produces clearer live guidance than a multi-error list. | Situation-awareness attention target and feedback suppression. | Blinded user/expert comparison of single-priority vs multi-cue feedback. |
| Anticipation is useful but uncertain. | Forecast feedback should be delivered only when confidence/agreement gates pass. | ACP-STGAT plus `forecastAwareness.js`. | Compare trusted/untrusted forecast cases and false-warning rate. |
| Movement meaning changes through a repetition. | Phase-aware assessment should reject invalid ordering and partial repetitions. | Phase classifier plus duration-aware decoder/state machine. | Boundary error, repetition detection and noise-transition tests. |

## Bias controls

- Separate the roles of designer, participant and evaluator in the report.
- Freeze evaluation criteria before viewing final test results.
- Blind model/condition labels during feedback rating.
- Use an independent martial-arts expert for a subset when possible.
- If no second expert is available, re-rate a blinded subset after 7–14 days.
- Preserve negative cases and observations that contradict the initial design.
- Report the martial-art styles, assumptions and technique scope influencing each
  rule rather than treating one expert perspective as universal.
- Triangulate technique judgments with observable landmarks, biomechanical data,
  other practitioners and published work.

## Suggested thesis methodology text

> The study adopted an expert-informed design-science approach with reflexive
> practitioner inquiry. The primary researcher has more than 25 years of martial-
> arts practice, training, cross-style study and research experience. Practitioner
> knowledge and structured first-person observations informed the functional
> decomposition of perception, temporal interpretation, anticipation, situation
> awareness and feedback, as well as initial technique rules and coaching
> priorities. These inputs were treated as design hypotheses rather than objective
> proof of universal human cognition. Hypotheses were operationalized through
> observable landmark features, biomechanical constraints, temporal models and
> deterministic evidence gates, then assessed using software verification, model
> metrics and planned participant/expert evaluation. Researcher self-review and
> style-specific bias were recognized, with blinded assessment and independent
> expert review recommended as controls.

## Future sensor-based extension

The longer-term goal of investigating more mechanically efficient martial-arts
movement should be framed as future research. Suitable evidence could include
kinematics plus force, pressure, inertial, muscle-activity, heart-rate/metabolic or
other ethically collected sensor signals. “Energy wasting” should be replaced with
measurable constructs such as unnecessary joint displacement, excess co-contraction,
force-transfer efficiency, movement time or physiological energy cost. The exact
measure depends on the research question and available validated instrumentation.
