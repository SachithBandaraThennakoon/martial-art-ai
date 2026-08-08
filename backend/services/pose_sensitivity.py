"""Deterministic sensitivity, robustness, and optimal-region analysis."""

from math import ceil, log2
from statistics import pstdev

from scipy.stats import qmc

from services.pose_biomechanics import evaluate_variables
from services.pose_variables import VARIABLE_DEFINITIONS


ANALYSIS_VERSION = "1.0.0"


def _weighted_score(scores, objective_weights):
    enabled = [(target, weight) for target, weight in objective_weights.items() if weight > 0]
    total = sum(weight for _, weight in enabled)
    return sum(scores[target] * weight for target, weight in enabled) / total


def _scores(variables):
    evaluation = evaluate_variables(variables)
    return {target: details["score"] for target, details in evaluation["targets"].items()}


def _sensitivity_label(effect):
    if effect < 5:
        return "Low"
    if effect < 15:
        return "Medium"
    return "High"


def _robustness_label(score):
    if score >= 80:
        return "High"
    if score >= 55:
        return "Medium"
    return "Low"


def derive_optimal_region(pareto_solutions):
    """Use a deterministic near-ideal Pareto subset, with enough points to form a region."""
    ordered = sorted(pareto_solutions, key=lambda item: (item["ideal_distance"], item["id"]))
    if not ordered:
        return {}, []
    minimum_count = min(len(ordered), max(3, ceil(len(ordered) * 0.2)))
    threshold = ordered[0]["ideal_distance"] + max(0.02, ordered[0]["ideal_distance"] * 0.25)
    selected = [item for item in ordered if item["ideal_distance"] <= threshold]
    if len(selected) < minimum_count:
        selected = ordered[:minimum_count]
    region = {}
    for variable_id in VARIABLE_DEFINITIONS:
        values = [item["variables"][variable_id] for item in selected]
        region[variable_id] = {
            "optimal_min": round(min(values), 6),
            "optimal_max": round(max(values), 6),
        }
    return region, [item["id"] for item in selected]


def analyze_sensitivity_and_robustness(
    representative_variables,
    search_ranges,
    pareto_solutions,
    objective_weights,
    seed=42,
    robustness_samples=32,
):
    """Analyze local effects and deterministic perturbations around the optimal region."""
    if robustness_samples < 4:
        raise ValueError("Robustness analysis requires at least four samples")
    optimal_region, region_solution_ids = derive_optimal_region(pareto_solutions)
    baseline_scores = _scores(representative_variables)
    baseline_composite = _weighted_score(baseline_scores, objective_weights)
    weight_total = sum(weight for weight in objective_weights.values() if weight > 0)

    variables_output = {}
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        bounds = search_ranges[variable_id]
        span = bounds["search_max"] - bounds["search_min"]
        minimum_delta = 1.0 if definition.unit == "degrees" else 0.01
        delta = max(span * 0.01, minimum_delta)
        lower = max(bounds["search_min"], representative_variables[variable_id] - delta)
        upper = min(bounds["search_max"], representative_variables[variable_id] + delta)
        lower_variables = dict(representative_variables)
        upper_variables = dict(representative_variables)
        lower_variables[variable_id] = lower
        upper_variables[variable_id] = upper
        lower_scores = _scores(lower_variables)
        upper_scores = _scores(upper_variables)
        denominator = max(upper - lower, 1e-12)
        target_effects = {
            target: round(abs(upper_scores[target] - lower_scores[target]) / denominator * span, 6)
            for target in baseline_scores
        }
        overall_effect = sum(
            target_effects[target] * weight
            for target, weight in objective_weights.items()
            if weight > 0
        ) / weight_total

        region = optimal_region[variable_id]
        region_values = [
            region["optimal_min"] + (region["optimal_max"] - region["optimal_min"]) * fraction
            for fraction in (0, 0.25, 0.5, 0.75, 1)
        ]
        composites = []
        for value in region_values:
            perturbed = dict(representative_variables)
            perturbed[variable_id] = value
            composites.append(_weighted_score(_scores(perturbed), objective_weights))
        deviation = pstdev(composites)
        worst_drop = max(0.0, baseline_composite - min(composites))
        robustness_score = max(0.0, min(100.0, 100 - deviation * 5 - worst_drop * 2))
        variables_output[variable_id] = {
            "label": definition.label,
            "target_sensitivity": target_effects,
            "sensitivity_score": round(overall_effect, 6),
            "sensitivity": _sensitivity_label(overall_effect),
            "robustness_score": round(robustness_score, 2),
            "robustness": _robustness_label(robustness_score),
        }

    dimensions = len(VARIABLE_DEFINITIONS)
    exponent = ceil(log2(robustness_samples))
    samples = qmc.Sobol(d=dimensions, scramble=True, seed=seed).random_base2(exponent)[:robustness_samples]
    target_samples = {target: [] for target in baseline_scores}
    variable_ids = list(VARIABLE_DEFINITIONS)
    for sample in samples:
        variables = dict(representative_variables)
        for index, variable_id in enumerate(variable_ids):
            region = optimal_region[variable_id]
            variables[variable_id] = region["optimal_min"] + sample[index] * (region["optimal_max"] - region["optimal_min"])
        sample_scores = _scores(variables)
        for target, score in sample_scores.items():
            target_samples[target].append(score)

    targets_output = {}
    for target, values in target_samples.items():
        deviation = pstdev(values)
        worst_drop = max(0.0, baseline_scores[target] - min(values))
        robustness_score = max(0.0, min(100.0, 100 - deviation * 5 - worst_drop * 2))
        targets_output[target] = {
            "baseline_score": baseline_scores[target],
            "mean_score": round(sum(values) / len(values), 2),
            "standard_deviation": round(deviation, 4),
            "worst_drop": round(worst_drop, 2),
            "robustness_score": round(robustness_score, 2),
            "robustness": _robustness_label(robustness_score),
        }

    return {
        "schema_version": "1.0",
        "analysis_version": ANALYSIS_VERSION,
        "method": "central_finite_difference_and_seeded_sobol",
        "seed": seed,
        "robustness_samples": robustness_samples,
        "region_solution_ids": region_solution_ids,
        "optimal_region": optimal_region,
        "variables": variables_output,
        "targets": targets_output,
    }
