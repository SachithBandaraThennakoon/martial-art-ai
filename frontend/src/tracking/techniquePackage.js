const SUPPORTED_OPERATORS = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "increasing",
  "decreasing",
  "stable",
  "near_baseline"
]);

const REQUIRED_PARTS = [
  "manifest",
  "states",
  "transitions",
  "errors",
  "modes"
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCondition(condition, path, issues) {
  if (!isRecord(condition)) {
    issues.push(`${path} must be an object`);
    return;
  }

  const groups = ["all", "any"].filter((key) => Array.isArray(condition[key]));
  if (groups.length) {
    groups.forEach((key) => {
      if (!condition[key].length) {
        issues.push(`${path}.${key} must contain at least one condition`);
      }
      condition[key].forEach((child, index) =>
        validateCondition(child, `${path}.${key}[${index}]`, issues)
      );
    });
    return;
  }

  if (!isNonEmptyString(condition.feature)) {
    issues.push(`${path}.feature is required`);
  }
  if (!SUPPORTED_OPERATORS.has(condition.operator)) {
    issues.push(`${path}.operator "${condition.operator}" is not supported`);
  }
  if (condition.operator === "between") {
    if (!Number.isFinite(condition.min) || !Number.isFinite(condition.max)) {
      issues.push(`${path} requires numeric min and max values`);
    } else if (condition.min > condition.max) {
      issues.push(`${path}.min cannot exceed max`);
    }
  } else if (["gt", "gte", "lt", "lte"].includes(condition.operator)) {
    if (!Number.isFinite(condition.value)) {
      issues.push(`${path}.value must be numeric`);
    }
  }
}

function validateConfirmation(confirmation, path, issues) {
  if (!isRecord(confirmation)) {
    issues.push(`${path} is required`);
    return;
  }
  if (!Number.isInteger(confirmation.min_frames) || confirmation.min_frames < 2) {
    issues.push(`${path}.min_frames must be an integer of at least 2`);
  }
  if (!Number.isFinite(confirmation.min_ms) || confirmation.min_ms < 0) {
    issues.push(`${path}.min_ms must be a non-negative number`);
  }
}

export class TechniquePackageValidationError extends Error {
  constructor(techniqueId, issues) {
    super(`Invalid technique package "${techniqueId || "unknown"}": ${issues.join("; ")}`);
    this.name = "TechniquePackageValidationError";
    this.techniqueId = techniqueId || null;
    this.issues = issues;
  }
}

export function validateTechniquePackage(source) {
  const issues = [];

  if (!isRecord(source)) {
    throw new TechniquePackageValidationError(null, ["package must be an object"]);
  }

  REQUIRED_PARTS.forEach((part) => {
    if (!isRecord(source[part])) issues.push(`${part} is required`);
  });

  if (issues.length) {
    throw new TechniquePackageValidationError(source.manifest?.id, issues);
  }

  const { manifest, states, transitions, errors, modes } = source;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id || "")) {
    issues.push("manifest.id must be a lowercase kebab-case identifier");
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
    issues.push("manifest.version must use semantic versioning");
  }
  if (!isNonEmptyString(manifest.tracking_profile)) {
    issues.push("manifest.tracking_profile is required");
  }
  if (!Array.isArray(manifest.required_features) || !manifest.required_features.length) {
    issues.push("manifest.required_features must contain at least one feature");
  }

  const stateNames = Object.keys(states.states || {});
  const stateSet = new Set(stateNames);
  if (!stateNames.length) issues.push("states.states must define at least one state");
  if (states.initial_state !== manifest.initial_state) {
    issues.push("manifest.initial_state and states.initial_state must match");
  }
  if (!stateSet.has(manifest.initial_state)) {
    issues.push(`initial state "${manifest.initial_state}" is not defined`);
  }
  if (
    !Array.isArray(states.state_order) ||
    states.state_order.length !== stateNames.length ||
    states.state_order.some((state) => !stateSet.has(state))
  ) {
    issues.push("states.state_order must contain every defined state exactly once");
  } else if (new Set(states.state_order).size !== states.state_order.length) {
    issues.push("states.state_order cannot contain duplicates");
  }

  stateNames.forEach((stateName) => {
    const state = states.states[stateName];
    const path = `states.states.${stateName}`;
    if (!Number.isFinite(state.min_duration_ms) || state.min_duration_ms < 0) {
      issues.push(`${path}.min_duration_ms must be non-negative`);
    }
    if (
      !Number.isFinite(state.max_duration_ms) ||
      state.max_duration_ms < state.min_duration_ms
    ) {
      issues.push(`${path}.max_duration_ms must be at least min_duration_ms`);
    }
    validateConfirmation(state.confirmation, `${path}.confirmation`, issues);
    validateCondition(state.enter_rules, `${path}.enter_rules`, issues);
  });

  const transitionMap = transitions.transitions || {};
  stateNames.forEach((sourceState) => {
    const transition = transitionMap[sourceState];
    if (!isRecord(transition)) {
      issues.push(`transitions.transitions.${sourceState} is required`);
      return;
    }
    if (!Array.isArray(transition.allowed)) {
      issues.push(`transitions.transitions.${sourceState}.allowed must be an array`);
      return;
    }
    transition.allowed.forEach((targetState) => {
      if (!stateSet.has(targetState)) {
        issues.push(`transition ${sourceState} -> ${targetState} references an unknown state`);
      }
    });
    if (
      Number.isFinite(transition.timeout_ms) &&
      transition.timeout_ms < states.states[sourceState].min_duration_ms
    ) {
      issues.push(`transition timeout for ${sourceState} is shorter than its minimum duration`);
    }
  });

  (errors.errors || []).forEach((errorRule, index) => {
    const path = `errors.errors[${index}]`;
    if (!isNonEmptyString(errorRule.id)) issues.push(`${path}.id is required`);
    if (!Array.isArray(errorRule.evaluate_during) || !errorRule.evaluate_during.length) {
      issues.push(`${path}.evaluate_during must contain at least one state`);
    } else {
      errorRule.evaluate_during.forEach((state) => {
        if (!stateSet.has(state)) issues.push(`${path} references unknown state "${state}"`);
      });
    }
    validateCondition(errorRule.condition, `${path}.condition`, issues);
    validateConfirmation(errorRule.confirmation, `${path}.confirmation`, issues);
  });

  ["train", "practice"].forEach((mode) => {
    const policy = modes[mode];
    if (!isRecord(policy)) {
      issues.push(`modes.${mode} is required`);
      return;
    }
    ["transition_confidence_min", "tracking_confidence_min"].forEach((key) => {
      if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1) {
        issues.push(`modes.${mode}.${key} must be between 0 and 1`);
      }
    });
    if (policy.offline_decoder !== undefined) {
      if (!isRecord(policy.offline_decoder)) {
        issues.push(`modes.${mode}.offline_decoder must be an object`);
      } else {
        const decoder = policy.offline_decoder;
        if (decoder.enabled !== undefined && typeof decoder.enabled !== "boolean") {
          issues.push(`modes.${mode}.offline_decoder.enabled must be boolean`);
        }
        [
          "emission_floor",
          "unknown_emission_threshold",
          "transition_penalty",
          "unknown_transition_penalty",
          "duration_overflow_penalty",
          "minimum_duration_ratio"
        ].forEach((key) => {
          if (
            decoder[key] !== undefined &&
            (!Number.isFinite(decoder[key]) || decoder[key] < 0)
          ) {
            issues.push(
              `modes.${mode}.offline_decoder.${key} must be non-negative`
            );
          }
        });
        if (
          decoder.unknown_min_duration_ms !== undefined &&
          (
            !Number.isFinite(decoder.unknown_min_duration_ms) ||
            decoder.unknown_min_duration_ms < 0
          )
        ) {
          issues.push(
            `modes.${mode}.offline_decoder.unknown_min_duration_ms must be non-negative`
          );
        }
      }
    }
  });

  if (issues.length) {
    throw new TechniquePackageValidationError(manifest.id, issues);
  }

  return true;
}

export function createTechniquePackage(source) {
  validateTechniquePackage(source);
  const stateNames = [...source.states.state_order];
  const stateSet = new Set(stateNames);

  return {
    ...source,
    id: source.manifest.id,
    version: source.manifest.version,
    stateNames,
    getState(stateName) {
      return source.states.states[stateName] || null;
    },
    getMode(mode) {
      return source.modes[mode] || null;
    },
    canTransition(fromState, toState) {
      return (
        stateSet.has(fromState) &&
        stateSet.has(toState) &&
        (source.transitions.transitions[fromState]?.allowed || []).includes(toState)
      );
    }
  };
}

export const techniqueRuleOperators = Object.freeze([...SUPPORTED_OPERATORS]);
