const normalizeFeedbackText = (message) =>
  String(message || "").toLowerCase().replace(/\s+/g, " ").trim();

export function getCoachFeedbackIntent(event) {
  if (event?.feedback_intent) return event.feedback_intent;
  if (event?.requires_response && event?.question?.kind) {
    return `question:${event.question.kind}`;
  }

  const message = event?.message || event?.summary || "";
  return `${event?.action || event?.state || "coach"}:${normalizeFeedbackText(message).replace(/\d+/g, "#")}`;
}

export function getPracticeFeedbackIntent(message) {
  const normalized = normalizeFeedbackText(message);

  if (/^\d+$/.test(normalized)) return `rep_count:${normalized}`;
  const selectedCount = normalized.match(/count set to (\d+)/)?.[1];
  if (selectedCount) return `count_selected:${selectedCount}`;
  if (/all reps complete|set complete|practice complete|practice again.*analysis/.test(normalized)) {
    return "set_complete";
  }
  if (/i will count|set in progress|follow each step/.test(normalized)) return "set_start";
  if (/step \d+.*ready|ready to start/.test(normalized)) {
    return `step_ready:${normalized.match(/step (\d+)/)?.[1] || "current"}`;
  }
  if (/set your reps|choose your reps|start when ready/.test(normalized)) return "setup_ready";
  if (/set already running|set is active/.test(normalized)) return "set_active";
  if (/no rush|i will wait/.test(normalized)) return "waiting";
  if (/reset/.test(normalized)) return "reset";

  return `message:${normalized.replace(/\d+/g, "#")}`;
}

export function repeatsPendingQuestion(event, previousIntent) {
  const intent = getCoachFeedbackIntent(event);
  return Boolean(event?.requires_response && intent === previousIntent);
}

export function buildPracticeSetMessage({ gapMs, reps, started = false, stepName = "the first step" }) {
  const gapSeconds = Number(gapMs) / 1000;
  const gapLabel = Number.isInteger(gapSeconds) ? String(gapSeconds) : gapSeconds.toFixed(1);

  if (started) {
    return `Set started: ${reps} reps, counting every ${gapLabel} seconds. Begin ${stepName}. I will lead the rhythm and score your movement separately.`;
  }

  return `${reps} reps selected. I will count every ${gapLabel} seconds. Press Start set when ready.`;
}
