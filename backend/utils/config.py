import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PAYPAL_MODE = os.getenv("PAYPAL_MODE", "sandbox")
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")
PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID")
