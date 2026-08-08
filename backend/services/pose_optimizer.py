"""Deterministic NSGA-II optimization for the complete static-pose vector."""

from math import sqrt

import numpy as np
from fastapi import HTTPException

try:
    from pymoo.algorithms.moo.nsga2 import NSGA2
    from pymoo.core.problem import ElementwiseProblem
    from pymoo.optimize import minimize
except ImportError:  # Keeps catalog reads available before optional deployment dependencies finish installing.
    NSGA2 = None
    ElementwiseProblem = object
    minimize = None

from services.pose_biomechanics import EVALUATOR_VERSION, evaluate_pose, evaluate_variables
from services.pose_kinematics import KINEMATICS_VERSION, reconstruct_pose
from services.pose_sensitivity import ANALYSIS_VERSION, analyze_sensitivity_and_robustness


OPTIMIZER_VERSION = "1.1.0"


class StaticPoseProblem(ElementwiseProblem):
    def __init__(self, variable_ids, bounds, objective_ids):
        self.variable_ids = variable_ids
        self.objective_ids = objective_ids
        lower = np.array([bounds[variable_id]["search_min"] for variable_id in variable_ids], dtype=float)
        upper = np.array([bounds[variable_id]["search_max"] for variable_id in variable_ids], dtype=float)
        super().__init__(n_var=len(variable_ids), n_obj=len(objective_ids), xl=lower, xu=upper)

    def _evaluate(self, x, out, *args, **kwargs):
        variables = {variable_id: float(x[index]) for index, variable_id in enumerate(self.variable_ids)}
        evaluation = evaluate_variables(variables)
        out["F"] = np.array([
            -evaluation["targets"][objective_id]["score"] / 100
            for objective_id in self.objective_ids
        ])


def _representative_index(score_rows, objective_ids, objective_weights):
    distances = []
    weight_total = sum(objective_weights[objective_id] for objective_id in objective_ids)
    for scores in score_rows:
        squared = sum(
            objective_weights[objective_id] * (1 - scores[objective_id] / 100) ** 2
            for objective_id in objective_ids
        )
        distances.append(sqrt(squared / weight_total))
    return min(range(len(distances)), key=lambda index: (distances[index], index)), distances


def optimize_pose_variables(
    range_result,
    objective_weights,
    pose_a=None,
    pose_b=None,
    seed=42,
    population_size=48,
    generations=60,
):
    """Optimize every pose variable together and return a reproducible Pareto set."""
    if NSGA2 is None or minimize is None:
        raise HTTPException(503, "Pose optimization is unavailable until the pymoo dependency is installed")
    ranges = range_result.get("ranges") or {}
    if not ranges:
        raise HTTPException(400, "Pose optimization requires generated search ranges")
    objective_ids = [objective_id for objective_id, weight in objective_weights.items() if weight > 0]
    if len(objective_ids) < 2:
        raise HTTPException(400, "NSGA-II requires at least two enabled optimization objectives")
    if not 16 <= population_size <= 300:
        raise HTTPException(400, "Population size must be between 16 and 300")
    if not 5 <= generations <= 500:
        raise HTTPException(400, "Generation count must be between 5 and 500")

    variable_ids = list(ranges)
    problem = StaticPoseProblem(variable_ids, ranges, objective_ids)
    result = minimize(
        problem,
        NSGA2(pop_size=population_size, eliminate_duplicates=True),
        ("n_gen", generations),
        seed=seed,
        verbose=False,
    )
    if result.X is None:
        raise HTTPException(422, "No feasible Pareto solutions were found")

    solutions = np.atleast_2d(result.X)
    variable_rows = [
        {variable_id: round(float(row[index]), 6) for index, variable_id in enumerate(variable_ids)}
        for row in solutions
    ]
    evaluations = [evaluate_variables(variables) for variables in variable_rows]
    score_rows = [
        {target: evaluation["targets"][target]["score"] for target in evaluation["targets"]}
        for evaluation in evaluations
    ]
    representative_index, distances = _representative_index(score_rows, objective_ids, objective_weights)

    reconstruction = None
    if pose_a is not None and pose_b is not None:
        reconstructed_candidates = []
        for candidate_index in sorted(range(len(distances)), key=lambda index: (distances[index], index)):
            candidate_reconstruction = reconstruct_pose(variable_rows[candidate_index], pose_a, pose_b)
            if candidate_reconstruction["feasible"]:
                reconstructed_candidates.append((
                    candidate_reconstruction["projection_rmse"],
                    distances[candidate_index],
                    candidate_index,
                    candidate_reconstruction,
                ))
        if reconstructed_candidates:
            exact_candidates = [candidate for candidate in reconstructed_candidates if candidate[3]["target_within_tolerance"]]
            selected = min(exact_candidates or reconstructed_candidates, key=lambda candidate: candidate[:3])
            _, _, representative_index, reconstruction = selected
        if reconstruction is None:
            raise HTTPException(422, "Pareto vectors were found, but landmark reconstruction violated bone safety constraints")

    pareto = []
    for index, (variables, scores) in enumerate(zip(variable_rows, score_rows)):
        pareto.append({
            "id": f"pareto-{index + 1}",
            "variables": variables,
            "target_scores": scores,
            "ideal_distance": round(distances[index], 8),
            "representative": index == representative_index,
        })
    pareto.sort(key=lambda item: (item["ideal_distance"], item["id"]))

    pareto_ranges = {}
    for variable_id in variable_ids:
        values = [solution["variables"][variable_id] for solution in pareto]
        pareto_ranges[variable_id] = {
            "optimal_min": round(min(values), 6),
            "optimal_max": round(max(values), 6),
            "representative_value": variable_rows[representative_index][variable_id],
        }

    representative_scores = score_rows[representative_index]
    if reconstruction:
        reconstructed_evaluation = evaluate_pose(reconstruction["reference_pose"])
        representative_scores = {
            target: details["score"]
            for target, details in reconstructed_evaluation["targets"].items()
        }
    analysis = analyze_sensitivity_and_robustness(
        variable_rows[representative_index],
        ranges,
        pareto,
        objective_weights,
        seed=seed,
    )
    representative_actual_variables = reconstruction["actual_variables"] if reconstruction else variable_rows[representative_index]
    optimal_ranges = {
        variable_id: {
            **region,
            "representative_value": representative_actual_variables[variable_id],
            "sensitivity": analysis["variables"][variable_id]["sensitivity"],
            "robustness": analysis["variables"][variable_id]["robustness"],
        }
        for variable_id, region in analysis["optimal_region"].items()
    }

    return {
        "schema_version": "1.0",
        "optimizer_version": OPTIMIZER_VERSION,
        "evaluator_version": EVALUATOR_VERSION,
        "kinematics_version": KINEMATICS_VERSION,
        "analysis_version": ANALYSIS_VERSION,
        "algorithm": "pymoo_nsga2",
        "seed": seed,
        "population_size": population_size,
        "generations": generations,
        "objective_ids": objective_ids,
        "decision_variable_ids": variable_ids,
        "representative_policy": "weighted_normalized_distance_to_ideal",
        "pareto_solution_count": len(pareto),
        "pareto_solutions": pareto,
        "pareto_ranges": pareto_ranges,
        "optimal_ranges": optimal_ranges,
        "representative_variables": representative_actual_variables,
        "representative_requested_variables": variable_rows[representative_index],
        "representative_requested_scores": score_rows[representative_index],
        "representative_scores": representative_scores,
        "representative_pose": reconstruction["reference_pose"] if reconstruction else None,
        "representative_reconstruction": reconstruction,
        "sensitivity_and_robustness": analysis,
    }
