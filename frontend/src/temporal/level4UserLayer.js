const DEFAULT_CONFIG = {
  storageKey: "martial_art_ai_level4_user_profile",
  updateIntervalMs: 1800,
  masteryReadyThreshold: 0.74,
  consistencyReadyThreshold: 0.7,
  fatigueLimit: 0.48,
  weaknessMinCount: 3
};

const EMPTY_PROFILE = {
  user_id: "local_user",
  user_level: "beginner",
  training_age_days: 0,
  created_at: null,
  updated_at: null,
  total_samples: 0,
  total_sessions_observed: 0,
  techniques: {},
  weakness_memory: {}
};

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function loadProfile(storageKey) {
  const storage = getStorage();
  if (!storage) return { ...EMPTY_PROFILE };

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return { ...EMPTY_PROFILE };
    return { ...EMPTY_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

function saveProfile(storageKey, profile) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(storageKey, JSON.stringify(profile));
  } catch {
    // Ignore storage quota/private-mode failures; the live user layer still works.
  }
}

function ema(previous, next, weight = 0.18) {
  if (!Number.isFinite(previous)) return round(next);
  return round(previous * (1 - weight) + next * weight);
}

function getTechniqueKey(techniqueName) {
  return String(techniqueName || "unknown_technique").trim().toLowerCase().replace(/\s+/g, "_");
}

function getTrend(previous, current, tolerance = 0.025) {
  if (!Number.isFinite(previous)) return "collecting";
  const delta = current - previous;
  if (delta > tolerance) return "improving";
  if (delta < -tolerance) return "dropping";
  return "stable";
}

function getUserLevel(profile, techniqueStats) {
  const averageMastery = round(
    Object.values(profile.techniques || {}).reduce((total, item) => total + (item.mastery_score || 0), 0) /
      Math.max(1, Object.keys(profile.techniques || {}).length)
  );

  if (profile.total_samples > 220 && averageMastery > 0.78 && (techniqueStats?.consistency_score || 0) > 0.72) {
    return "intermediate";
  }
  return "beginner";
}

function getWeaknessKey(mistake) {
  if (!mistake?.body_part && !mistake?.label) return null;
  return `${mistake.body_part || mistake.label}:${mistake.issue || "issue"}`;
}

function getTopWeakness(profile, techniqueKey) {
  return Object.values(profile.weakness_memory || {})
    .filter((item) => item.technique_key === techniqueKey)
    .sort((first, second) => second.count - first.count)[0] || null;
}

function getRecommendation({ techniqueStats, topWeakness, session }) {
  if ((session.fatigue_risk || 0) > DEFAULT_CONFIG.fatigueLimit) return "lower_intensity_next";
  if (topWeakness && topWeakness.count >= DEFAULT_CONFIG.weaknessMinCount) return "train_weakness_drill";
  if ((techniqueStats.mastery_score || 0) >= 0.74 && (techniqueStats.consistency_score || 0) >= 0.7) {
    return "unlock_next_technique";
  }
  if (techniqueStats.learning_trend === "dropping") return "repeat_foundation";
  return "continue_personal_plan";
}

function getCoachMessage({ recommendation, topWeakness }) {
  if (recommendation === "unlock_next_technique") return "Long-term profile is ready for the next technique.";
  if (recommendation === "lower_intensity_next") return "Next session should be slower to protect form quality.";
  if (recommendation === "train_weakness_drill" && topWeakness) {
    return `Next focus: ${topWeakness.body_part.replace(/_/g, " ")} ${topWeakness.issue.replace(/_/g, " ")}.`;
  }
  if (recommendation === "repeat_foundation") return "Trend is dropping. Repeat the foundation before adding speed.";
  return "Keep collecting user history for a better personal plan.";
}

export class Level4UserLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.profile = loadProfile(this.config.storageKey);
    this.lastUpdateMs = 0;
    this.latestState = null;
  }

  update({ level3State, techniqueName = "", currentStepName = "" }) {
    const session = level3State?.session_context;
    if (!session) return this.latestState;

    const timestampMs = (level3State.timestamp || Date.now() / 1000) * 1000;
    if (timestampMs - this.lastUpdateMs < this.config.updateIntervalMs) {
      return this.latestState;
    }

    this.lastUpdateMs = timestampMs;

    const nowIso = new Date(timestampMs).toISOString();
    const techniqueKey = getTechniqueKey(techniqueName || session.technique_name);
    const previousTechniqueStats = this.profile.techniques?.[techniqueKey] || {};
    const previousMastery = previousTechniqueStats.mastery_score;
    const masteryScore = ema(previousTechniqueStats.mastery_score, session.mastery_score || 0);
    const consistencyScore = ema(previousTechniqueStats.consistency_score, session.consistency_score || 0);
    const fatigueRisk = ema(previousTechniqueStats.fatigue_risk, session.fatigue_risk || 0, 0.12);
    const samples = (previousTechniqueStats.samples || 0) + 1;
    const sessionsCompleted =
      (previousTechniqueStats.sessions_completed || 0) + (session.ready_for_level_4 ? 1 : 0);

    const techniqueStats = {
      technique_key: techniqueKey,
      technique_name: techniqueName || session.technique_name || "Unknown technique",
      current_step_name: currentStepName || session.current_step_name || null,
      samples,
      sessions_completed: sessionsCompleted,
      mastery_score: masteryScore,
      best_mastery_score: round(Math.max(previousTechniqueStats.best_mastery_score || 0, session.mastery_score || 0)),
      consistency_score: consistencyScore,
      fatigue_risk: fatigueRisk,
      learning_trend: getTrend(previousMastery, masteryScore),
      last_seen_at: nowIso
    };

    const weaknessMemory = { ...(this.profile.weakness_memory || {}) };
    const weaknessKey = getWeaknessKey(session.repeated_mistake);
    if (weaknessKey) {
      const existing = weaknessMemory[`${techniqueKey}:${weaknessKey}`] || {};
      weaknessMemory[`${techniqueKey}:${weaknessKey}`] = {
        technique_key: techniqueKey,
        body_part: session.repeated_mistake.body_part || session.repeated_mistake.label,
        issue: session.repeated_mistake.issue || "issue",
        count: (existing.count || 0) + 1,
        last_seen_at: nowIso
      };
    }

    const createdAt = this.profile.created_at || nowIso;
    this.profile = {
      ...this.profile,
      created_at: createdAt,
      updated_at: nowIso,
      training_age_days: Math.max(0, Math.floor((timestampMs - Date.parse(createdAt)) / 86400000)),
      total_samples: (this.profile.total_samples || 0) + 1,
      total_sessions_observed: (this.profile.total_sessions_observed || 0) + (session.ready_for_level_4 ? 1 : 0),
      techniques: {
        ...(this.profile.techniques || {}),
        [techniqueKey]: techniqueStats
      },
      weakness_memory: weaknessMemory
    };
    this.profile.user_level = getUserLevel(this.profile, techniqueStats);
    saveProfile(this.config.storageKey, this.profile);

    const topWeakness = getTopWeakness(this.profile, techniqueKey);
    const recommendation = getRecommendation({ techniqueStats, topWeakness, session });
    const readyForNextTechnique =
      recommendation === "unlock_next_technique" &&
      (session.fatigue_risk || 0) <= this.config.fatigueLimit;

    this.latestState = {
      timestamp: level3State.timestamp,
      user_context: {
        user_id: this.profile.user_id,
        user_level: this.profile.user_level,
        training_age_days: this.profile.training_age_days,
        total_samples: this.profile.total_samples,
        total_sessions_observed: this.profile.total_sessions_observed,
        active_technique: techniqueStats,
        top_weakness: topWeakness,
        personalization: {
          coaching_intensity: fatigueRisk > 0.55 ? "low" : this.profile.user_level === "beginner" ? "medium" : "high",
          recommended_speed: fatigueRisk > 0.5 || topWeakness ? "slow" : "normal",
          next_focus: topWeakness
            ? `${topWeakness.body_part}_${topWeakness.issue}`
            : techniqueStats.learning_trend === "dropping"
              ? "foundation_reset"
              : "clean_repetition"
        },
        progression: {
          recommendation,
          ready_for_next_technique: readyForNextTechnique,
          ready_for_level_5: readyForNextTechnique && this.profile.total_sessions_observed >= 3,
          coach_message: getCoachMessage({ recommendation, topWeakness })
        }
      },
      debug: {
        stored_techniques: Object.keys(this.profile.techniques || {}).length,
        stored_weaknesses: Object.keys(this.profile.weakness_memory || {}).length,
        storage_key: this.config.storageKey
      }
    };

    return this.latestState;
  }
}
