import html
import logging
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "resend").strip().lower()
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
PASSWORD_RESET_FROM_EMAIL = os.getenv(
    "PASSWORD_RESET_FROM_EMAIL",
    "XMartialArt <security@xceed.live>",
).strip()
AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING = os.getenv(
    "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING",
    "",
).strip()
AZURE_EMAIL_SENDER = os.getenv("AZURE_EMAIL_SENDER", "").strip()


def email_delivery_configured() -> bool:
    if EMAIL_PROVIDER == "azure":
        return bool(AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING and AZURE_EMAIL_SENDER)
    if EMAIL_PROVIDER == "resend":
        return bool(RESEND_API_KEY and PASSWORD_RESET_FROM_EMAIL)
    return False


def _email_content(recipient: str, reset_url: str) -> tuple[str, str]:
    safe_url = html.escape(reset_url, quote=True)
    safe_recipient = html.escape(recipient)
    html_content = f"""
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
        <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">XMartialArt · Xceed</p>
        <h1 style="font-size:30px;line-height:1.15">Reset your password</h1>
        <p>We received a password reset request for {safe_recipient}.</p>
        <p style="margin:28px 0">
          <a href="{safe_url}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#111827;color:#fff;font-weight:700;text-decoration:none">Choose a new password</a>
        </p>
        <p>This link expires in 30 minutes and can be used only once.</p>
        <p style="color:#6b7280">If you did not request this change, you can safely ignore this email.</p>
      </div>
    """
    text_content = (
        "Reset your XMartialArt password\n\n"
        f"Open this link within 30 minutes: {reset_url}\n\n"
        "If you did not request this change, ignore this email."
    )
    return html_content, text_content


def _send_with_azure(recipient: str, reset_url: str) -> bool:
    try:
        from azure.communication.email import EmailClient
    except ImportError:
        logger.error("Azure email delivery unavailable: azure-communication-email is not installed")
        return False

    html_content, text_content = _email_content(recipient, reset_url)
    message = {
        "senderAddress": AZURE_EMAIL_SENDER,
        "recipients": {"to": [{"address": recipient}]},
        "content": {
            "subject": "Reset your XMartialArt password",
            "plainText": text_content,
            "html": html_content,
        },
    }

    try:
        client = EmailClient.from_connection_string(
            AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING
        )
        client.begin_send(message).result()
        return True
    except Exception as exc:  # Azure SDK exposes several transport exception types.
        logger.error("Azure password reset email delivery failed: %s", exc)
        return False


def _send_with_resend(recipient: str, reset_url: str) -> bool:
    html_content, text_content = _email_content(recipient, reset_url)
    payload = {
        "from": PASSWORD_RESET_FROM_EMAIL,
        "to": [recipient],
        "subject": "Reset your XMartialArt password",
        "html": html_content,
        "text": text_content,
    }

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.error("Resend password reset email delivery failed: %s", exc)
        return False


def send_password_reset_email(recipient: str, reset_url: str) -> bool:
    """Send a reset link without exposing provider errors to the API caller."""
    if not email_delivery_configured():
        logger.warning("Password reset email not sent: %s is not configured", EMAIL_PROVIDER)
        return False

    if EMAIL_PROVIDER == "azure":
        return _send_with_azure(recipient, reset_url)
    return _send_with_resend(recipient, reset_url)
