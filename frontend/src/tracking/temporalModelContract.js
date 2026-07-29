const RESERVED_LABELS = new Set([
  "__PAD__",
  "__UNKNOWN__",
  "__TRACKING_LOST__"
]);

const clampProbability = (value) =>
  Math.max(0, Math.min(1, Number(value) || 0));

export function validateTemporalModelMetadata(metadata, techniquePackage) {
  const errors = [];
  const normalized = normalizeTemporalModelMetadata(metadata);
  if (normalized?.model_type !== "temporal-state-emission") {
    errors.push("model_type must be temporal-state-emission");
  }
  if (normalized?.input?.layout !== "BTVC") {
    errors.push("input.layout must be BTVC");
  }
  if (Number(normalized?.input?.joints) !== 33) {
    errors.push("input.joints must be 33");
  }
  const labels = normalized?.output?.labels;
  if (!Array.isArray(labels) || !labels.length) {
    errors.push("output.labels must be a non-empty array");
  } else if (techniquePackage?.stateNames) {
    const modelStates = new Set(
      labels.filter((label) => !RESERVED_LABELS.has(label))
    );
    techniquePackage.stateNames.forEach((state) => {
      if (!modelStates.has(state)) {
        errors.push(`model is missing technique state ${state}`);
      }
    });
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateUniversalTemporalMetadata(metadata, techniquePackage) {
  const errors = [];
  if (metadata?.model_type !== "universal-temporal-phase") {
    errors.push("model_type must be universal-temporal-phase");
  }
  if (metadata?.inputs?.landmarks?.layout !== "BTVC") {
    errors.push("inputs.landmarks.layout must be BTVC");
  }
  if (Number(metadata?.inputs?.landmarks?.joints) !== 33) {
    errors.push("inputs.landmarks.joints must be 33");
  }
  const techniqueLabels = metadata?.inputs?.technique?.labels;
  const techniqueIndex = Array.isArray(techniqueLabels)
    ? techniqueLabels.indexOf(techniquePackage?.id)
    : -1;
  if (techniqueIndex < 0) {
    errors.push(`model does not support technique ${techniquePackage?.id}`);
  }
  const phaseLabels = metadata?.output?.labels;
  if (!Array.isArray(phaseLabels) || !phaseLabels.length) {
    errors.push("output.labels must be a non-empty array");
  }
  const phaseMap =
    metadata?.techniques?.[techniquePackage?.id]?.phase_to_native;
  if (!phaseMap || typeof phaseMap !== "object") {
    errors.push(`model is missing phase mapping for ${techniquePackage?.id}`);
  } else {
    const mappedStates = new Set(Object.values(phaseMap));
    techniquePackage?.stateNames?.forEach((state) => {
      if (!mappedStates.has(state)) {
        errors.push(`phase mapping does not cover technique state ${state}`);
      }
    });
  }
  return { valid: errors.length === 0, errors, techniqueIndex };
}

export function normalizeTemporalModelMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return metadata;
  if (metadata.model_type && metadata.input && metadata.output?.labels) {
    return metadata;
  }
  const labels = Array.isArray(metadata.state_names) ? metadata.state_names : [];
  return {
    ...metadata,
    model_type: "temporal-state-emission",
    input: {
      name: "landmarks",
      layout: "BTVC",
      joints: 33,
      sequence_length: Number(metadata.sequence_length) || 90,
      channels: metadata.input_channels || ["x", "y", "z", "visibility"]
    },
    output: {
      name: "state_logits",
      type: metadata.output,
      labels
    }
  };
}

export function logitsToStateProbabilities(logits, labels) {
  if (!Array.isArray(logits) || !Array.isArray(labels)) return {};
  const finite = logits.map((value) =>
    Number.isFinite(Number(value)) ? Number(value) : -100
  );
  const maximum = Math.max(...finite);
  const exponentials = finite.map((value) => Math.exp(value - maximum));
  const denominator =
    exponentials.reduce((total, value) => total + value, 0) || 1;
  return Object.fromEntries(
    labels.map((label, index) => [
      label,
      exponentials[index] / denominator
    ])
  );
}

export function blendTemporalStateEvidence(
  ruleScores,
  learnedProbabilities,
  {
    learnedWeight = 0.45,
    minimumLearnedConfidence = 0.45
  } = {}
) {
  const learnedMaximum = Math.max(
    0,
    ...Object.entries(learnedProbabilities || {})
      .filter(([label]) => !RESERVED_LABELS.has(label))
      .map(([, value]) => clampProbability(value))
  );
  const effectiveWeight =
    learnedMaximum >= minimumLearnedConfidence
      ? clampProbability(learnedWeight)
      : 0;
  const labels = new Set([
    ...Object.keys(ruleScores || {}),
    ...Object.keys(learnedProbabilities || {}).filter(
      (label) => !RESERVED_LABELS.has(label)
    )
  ]);
  return Object.fromEntries(
    [...labels].map((label) => {
      const rule = clampProbability(ruleScores?.[label]);
      const learned = clampProbability(learnedProbabilities?.[label]);
      return [
        label,
        rule * (1 - effectiveWeight) + learned * effectiveWeight
      ];
    })
  );
}
