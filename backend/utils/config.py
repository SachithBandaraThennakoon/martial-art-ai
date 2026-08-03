import os
from dotenv import load_dotenv

load_dotenv()

PAYPAL_MODE = os.getenv("PAYPAL_MODE", "sandbox").strip().lower()
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")
PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID")

if PAYPAL_MODE not in {"sandbox", "live"}:
    raise RuntimeError("PAYPAL_MODE must be either sandbox or live")
