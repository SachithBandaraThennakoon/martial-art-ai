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

export function getStudioPerformanceConfig(profile = "student", overrides = {}) {
  return {
    ...STUDIO_PERFORMANCE_PROFILES.student,
    ...(STUDIO_PERFORMANCE_PROFILES[profile] || {}),
    ...overrides
  };
}

export function getAdaptiveSmoothing({ trackingConfidence = 1, motionEnergy = 0 } = {}) {
  if (trackingConfidence < 0.45) return 0.32;
  if (trackingConfidence < 0.65) return 0.42;
  if (motionEnergy > 0.085) return 0.72;
  if (motionEnergy > 0.045) return 0.64;
  return 0.54;
}
