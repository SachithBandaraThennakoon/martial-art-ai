export const STUDIO_PERFORMANCE_PROFILES = {
  student: {
    poseFps: 24,
    handIntervalMs: 260,
    faceIntervalMs: 1800,
    maxHandStaleMs: 900,
    maxFaceStaleMs: 1800,
    level1UiIntervalMs: 500,
    level2UiIntervalMs: 650,
    level3UiIntervalMs: 1000,
    level4UiIntervalMs: 1800,
    situationUiIntervalMs: 1000,
    awarenessIntervalMs: 380,
    coachFrameIntervalMs: 320,
    coachContextIntervalMs: 3000,
    onnxIntervalMs: 1200,
    enableFace: false,
    handMode: "auto",
    onnxEnabled: false
  },
  admin: {
    poseFps: 20,
    handIntervalMs: 320,
    faceIntervalMs: 2200,
    maxHandStaleMs: 1100,
    maxFaceStaleMs: 2200,
    level1UiIntervalMs: 700,
    level2UiIntervalMs: 850,
    level3UiIntervalMs: 1200,
    level4UiIntervalMs: 2200,
    situationUiIntervalMs: 1200,
    awarenessIntervalMs: 450,
    coachFrameIntervalMs: 380,
    coachContextIntervalMs: 3500,
    onnxIntervalMs: 1400,
    enableFace: false,
    handMode: "auto",
    onnxEnabled: false
  },
  analysis: {
    poseFps: 16,
    handIntervalMs: 260,
    faceIntervalMs: 1400,
    maxHandStaleMs: 900,
    maxFaceStaleMs: 1800,
    level1UiIntervalMs: 500,
    level2UiIntervalMs: 600,
    level3UiIntervalMs: 900,
    level4UiIntervalMs: 1600,
    situationUiIntervalMs: 900,
    awarenessIntervalMs: 360,
    coachFrameIntervalMs: 320,
    coachContextIntervalMs: 2800,
    onnxIntervalMs: 900,
    enableFace: true,
    handMode: "auto",
    onnxEnabled: true
  }
};

export const STUDIO_PERFORMANCE_MODES = {
  auto: { label: "Auto", description: "Adjusts tracking load to this device." },
  eco: { label: "Eco", description: "Best for older laptops and mobile devices." },
  balanced: { label: "Balanced", description: "Smooth coaching with moderate detail." },
  quality: { label: "Quality", description: "Maximum detail for faster devices." }
};

const PERFORMANCE_MODE_OVERRIDES = {
  eco: {
    poseFps: 15,
    handIntervalMs: 480,
    awarenessIntervalMs: 650,
    coachFrameIntervalMs: 500,
    coachContextIntervalMs: 4500,
    level1UiIntervalMs: 750,
    level2UiIntervalMs: 900,
    level3UiIntervalMs: 1400,
    level4UiIntervalMs: 2400,
    situationUiIntervalMs: 1400
  },
  balanced: {
    poseFps: 20,
    handIntervalMs: 340,
    awarenessIntervalMs: 480,
    coachFrameIntervalMs: 400,
    coachContextIntervalMs: 3600,
    level1UiIntervalMs: 600,
    level2UiIntervalMs: 750,
    level3UiIntervalMs: 1100,
    level4UiIntervalMs: 2000,
    situationUiIntervalMs: 1100
  },
  quality: {
    poseFps: 24,
    handIntervalMs: 240,
    awarenessIntervalMs: 340,
    coachFrameIntervalMs: 300,
    coachContextIntervalMs: 2800,
    level1UiIntervalMs: 450,
    level2UiIntervalMs: 550,
    level3UiIntervalMs: 850,
    level4UiIntervalMs: 1600,
    situationUiIntervalMs: 850
  }
};

export function getStudioPerformanceConfig(profile = "student", overrides = {}) {
  return {
    ...STUDIO_PERFORMANCE_PROFILES.student,
    ...(STUDIO_PERFORMANCE_PROFILES[profile] || {}),
    ...overrides
  };
}

export function applyStudioPerformanceMode(config, mode = "auto", autoTier = "balanced") {
  const resolvedMode = mode === "auto" ? autoTier : mode;
  return {
    ...config,
    ...(PERFORMANCE_MODE_OVERRIDES[resolvedMode] || PERFORMANCE_MODE_OVERRIDES.balanced),
    performanceMode: mode,
    resolvedPerformanceMode: resolvedMode
  };
}

export function getAdaptiveSmoothing({ trackingConfidence = 1, motionEnergy = 0 } = {}) {
  if (trackingConfidence < 0.45) return 0.32;
  if (trackingConfidence < 0.65) return 0.42;
  if (motionEnergy > 0.085) return 0.72;
  if (motionEnergy > 0.045) return 0.64;
  return 0.54;
}
