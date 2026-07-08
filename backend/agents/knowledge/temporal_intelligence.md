# Temporal Intelligence Knowledge

Backend coach agents receive compact temporal context from the frontend. They should use this knowledge to interpret the values without needing raw skeleton frames.

## Level 1 Motion

- Time scale: current frame to short-horizon motion.
- Prediction horizon: about `t+100ms` to `t+300ms`.
- Meaning: raw pose tracking quality, joint angles, velocity, acceleration, and short motion prediction.
- Use for: body mechanics, camera/tracking quality, and immediate motion quality.
- Trust rule: do not give strong technique correction when tracking confidence is low.

## Level 2 Action

- Time scale: current technique step to action horizon.
- Prediction horizon: about `t+1s`.
- Meaning: current step state, action prediction, likely mistake, mistake risk, and next-step prediction.
- Use for: immediate technique corrections and repeat/continue decisions.
- Trust rule: prefer Level 2 for technique feedback only when Level 1 tracking is stable.

## Level 3 Session

- Time scale: current training session.
- Prediction horizon: next repetitions to the next few minutes.
- Meaning: session mastery, consistency, fatigue risk, trend, repeated mistakes, and session recommendation.
- Use for: pacing, fatigue warnings, repeat/advance strategy, and session-level coaching.
- Trust rule: treat it as a trend signal, not a single-frame fact.

## Level 4 User

- Time scale: long-term user history.
- Prediction horizon: future sessions.
- Meaning: user level, long-term weakness memory, personalization settings, and progression readiness.
- Use for: personalized feedback intensity, recommended speed, next focus, and long-term training plan.
- Trust rule: use it as personalization context; current decisions still depend on live Levels 1-3.

## Situation Awareness

- Time scale: decision moment.
- Prediction horizon: now to the next feedback window.
- Meaning: combines Levels 1-4 into an attention target, feedback decision, next action, and agent context.
- Use for: whether to speak now, what to correct, whether to pause progression, and what backend agent should reason about.
- Trust rule: if `decision_score` is low, observe instead of interrupting.

## Agent Priority Rules

1. If Level 1 tracking is unclear, ask the user to move into view before correcting technique.
2. If Situation Awareness says `warning`, prioritize fatigue/reset feedback.
3. If Situation Awareness says `correcting`, correct the `attention_target`.
4. If Level 4 weakness matches Level 2 mistake, make the correction personal and specific.
5. If Situation Awareness says `advance_ready`, keep feedback short and allow progression.
6. Avoid repeating the same spoken message unless the situation state or target changed.
