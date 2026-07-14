import os
import logging
from openai import OpenAI
from dotenv import load_dotenv
import base64

load_dotenv()

logger = logging.getLogger(__name__)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

ALLOWED_VOICES = {
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
}


def generate_voice(text, voice="cedar"):
    selected_voice = voice if voice in ALLOWED_VOICES else "cedar"

    try:
        response = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            voice=selected_voice,
            input=text,
            instructions=(
                "Speak like a calm martial arts master. Be grounded, clear, "
                "patient, and concise. Do not sound excited or robotic."
            ),
            response_format="mp3"
        )

        audio_bytes = response.read()

        return base64.b64encode(audio_bytes).decode("utf-8")

    except Exception as exc:
        logger.warning("Voice generation failed: %s", exc)
        return None
