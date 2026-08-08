"""Static anatomical and safety constraints for pose search variables."""

from fastapi import HTTPException

from services.pose_variables import VARIABLE_DEFINITIONS


def evaluate_constraint_violations(variables):
    """Return deterministic, machine-readable violations without raising."""
    violations = []
    for variable_id, definition in VARIABLE_DEFINITIONS.items():
        value = variables.get(variable_id)
        if value is None:
            violations.append({
                "variable": variable_id,
                "label": definition.label,
                "type": "missing",
                "message": f"{definition.label} is missing",
            })
        elif value < definition.constraint_min or value > definition.constraint_max:
            violations.append({
                "variable": variable_id,
                "label": definition.label,
                "type": "outside_range",
                "value": value,
                "minimum": definition.constraint_min,
                "maximum": definition.constraint_max,
                "message": f"{definition.label} is outside the supported safety range",
            })
    return violations


def validate_endpoint(variable_id, value, endpoint_label, step_index=None):
    definition = VARIABLE_DEFINITIONS[variable_id]
    prefix = f"Step {step_index} " if step_index is not None else ""
    if not definition.constraint_min <= value <= definition.constraint_max:
        raise HTTPException(
            400,
            f"{prefix}{endpoint_label} {definition.label} is outside the supported safety constraints",
        )


def constrain_search_range(variable_id, lower, upper, step_index=None):
    """Intersect an endpoint range with the supported constraint envelope."""
    definition = VARIABLE_DEFINITIONS[variable_id]
    prefix = f"Step {step_index} " if step_index is not None else ""
    if lower > definition.constraint_max or upper < definition.constraint_min:
        raise HTTPException(
            400,
            f"{prefix}{definition.label} endpoints are outside the supported safety constraints",
        )
    return (
        max(lower, definition.constraint_min),
        min(upper, definition.constraint_max),
    )
