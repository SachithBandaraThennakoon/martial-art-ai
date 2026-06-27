from agents.movement_agent import analyze_movement
from agents.coaching_agent import generate_feedback
from agents.summary_agent import generate_summary   


def run_agents(required_parts, live_angles):
    # Step 1: Movement analysis
    analysis = analyze_movement(required_parts, live_angles)

    # Step 2: Coaching AI
    feedback = generate_feedback(analysis)

    # Step 3: Summary AI (handled in main.py to maintain history)
    summary = generate_summary([feedback])

    return {
        "analysis": analysis,
        "feedback": feedback,
        "summary": summary
    }