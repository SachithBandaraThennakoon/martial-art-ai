import os
from openai import OpenAI
from dotenv import load_dotenv
import base64

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def generate_voice(text):
    try:
        response = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            voice="alloy",  # you can change voice
            input=text
        )

        # Convert to base64 so frontend can play
        audio_bytes = response.read()

        return base64.b64encode(audio_bytes).decode("utf-8")

    except Exception as e:
        print("Voice error:", e)
        return None