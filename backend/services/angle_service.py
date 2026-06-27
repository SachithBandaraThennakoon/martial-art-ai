from sqlalchemy.orm import Session
from models.target_angle import TargetAngle


def compare_angles(db: Session, step_id: int, live_angles: dict):
    target_angles = db.query(TargetAngle).filter(
        TargetAngle.step_id == step_id
    ).all()

    if not target_angles:
        return {
            "accuracy": 0,
            "feedback": ["No target angles configured for this step"]
        }

    total_parts = 0
    correct_parts = 0
    feedback_messages = []

    for target in target_angles:
        body_part = target.body_part

        if body_part in live_angles:
            total_parts += 1
            live_value = live_angles[body_part]

            if target.min_angle <= live_value <= target.max_angle:
                correct_parts += 1
            elif live_value < target.min_angle:
                feedback_messages.append(
                    f"Increase {body_part} angle"
                )
            else:
                feedback_messages.append(
                    f"Decrease {body_part} angle"
                )

    if total_parts == 0:
        return {
            "accuracy": 0,
            "feedback": ["No matching body parts detected"]
        }

    accuracy = round((correct_parts / total_parts) * 100, 2)

    if not feedback_messages:
        feedback_messages.append("Perfect form!")

    return {
        "accuracy": accuracy,
        "feedback": feedback_messages
    }