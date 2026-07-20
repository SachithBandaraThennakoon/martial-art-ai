import html
import logging
import os

import httpx

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
PASSWORD_RESET_FROM_EMAIL = os.getenv(
    "PASSWORD_RESET_FROM_EMAIL",
    "XMartialArt <security@xceed.live>",
).strip()


def send_password_reset_email(recipient: str, reset_url: str) -> bool:
    """Send a reset link without exposing provider errors to the API caller."""
    if not RESEND_API_KEY:
        logger.warning("Password reset email not sent: RESEND_API_KEY is not configured")
        return False

    safe_url = html.escape(reset_url, quote=True)
    safe_recipient = html.escape(recipient)
    payload = {
        "from": PASSWORD_RESET_FROM_EMAIL,
        "to": [recipient],
        "subject": "Reset your XMartialArt password",
        "html": f"""
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
        """,
        "text": (
            "Reset your XMartialArt password\n\n"
            f"Open this link within 30 minutes: {reset_url}\n\n"
            "If you did not request this change, ignore this email."
        ),
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
        logger.error("Password reset email delivery failed: %s", exc)
        return False
