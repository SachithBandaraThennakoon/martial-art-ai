"""Generate deterministic optimization bounds from two endpoint poses."""

from fastapi import HTTPException

from services.pose_constraints import constrain_search_range, validate_endpoint
from services.pose_variables import VARIABLE_DEFINITIONS, extract_pose_variables


def generate_search_ranges(pose_a, pose_b, margin=None, step_index=None):
    margin = margin or {}
    angle_margin = float(margin.get("angle_degrees", 0))
    position_margin = float(margin.get("position_normalized", 0))
    try:
        variables_a = extract_pose_variables(pose_a)
        variables_b = extract_pose_variables(pose_b)
    except (KeyError, TypeError, ValueError) as error:
        prefix = f"Step {step_index} " if step_index is not None else ""
        raise HTTPException(400, f"{prefix}cannot generate pose ranges: {error}") from None

    ranges = {}
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        endpoint_a = variables_a[variable_id]
        endpoint_b = variables_b[variable_id]
        validate_endpoint(variable_id, endpoint_a, "Pose A", step_index)
        validate_endpoint(variable_id, endpoint_b, "Pose B", step_index)
        configured_margin = angle_margin if definition.unit == "degrees" else position_margin
        lower, upper = constrain_search_range(
            variable_id,
            min(endpoint_a, endpoint_b) - configured_margin,
            max(endpoint_a, endpoint_b) + configured_margin,
            step_index,
        )
        ranges[variable_id] = {
            "label": definition.label,
            "unit": definition.unit,
            "group": definition.group,
            "pose_a_value": endpoint_a,
            "pose_b_value": endpoint_b,
            "search_min": round(lower, 6),
            "search_max": round(upper, 6),
            "constraint_min": definition.constraint_min,
            "constraint_max": definition.constraint_max,
        }

    return {
        "schema_version": "1.0",
        "variables_a": variables_a,
        "variables_b": variables_b,
        "ranges": ranges,
    }
