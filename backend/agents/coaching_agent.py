from openai import OpenAI
from utils.config import OPENAI_API_KEY

client = OpenAI(api_key=OPENAI_API_KEY)


def generate_feedback(analysis):
    prompt = f"""
You are a martial arts coach.

Based on the movement analysis below, give short and clear coaching feedback.

Analysis:
{analysis}

Rules:
- Be concise
- Give actionable advice
- Mention body parts
- Encourage improvement
- Focus on the most critical issues
- max 11 words per feedback point
- Provide 5 feedback points at most with good and bad points
- for good points, use positive emojis (e.g. "👍", "👏", "✅")
- for bad points, use negative emojis (e.g. "👎", "❌", "⚠️")
- All points include angle value and target range after the advice
- bulet point format
- each point add new line

example feedback format:
- 👎 Left Elbow: Too low at 45° (target 90 to 120°)
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are an expert martial arts coach."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5
    )

    return response.choices[0].message.content