import httpx

from utils.config import (
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PAYPAL_MODE,
    PAYPAL_WEBHOOK_ID,
)


class PayPalAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


API_BASE = (
    "https://api-m.paypal.com"
    if PAYPAL_MODE.strip().lower() == "live"
    else "https://api-m.sandbox.paypal.com"
)


def _require_api_configuration() -> None:
    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET:
        raise PayPalAPIError("PayPal API credentials are not configured")


async def get_access_token(client: httpx.AsyncClient) -> str:
    _require_api_configuration()
    try:
        response = await client.post(
            f"{API_BASE}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        token = response.json().get("access_token")
    except (httpx.HTTPError, ValueError) as exc:
        raise PayPalAPIError("PayPal authentication is temporarily unavailable") from exc
    if not token:
        raise PayPalAPIError("PayPal authentication returned no access token")
    return str(token)


async def get_subscription(
    subscription_id: str,
    *,
    client: httpx.AsyncClient | None = None,
    access_token: str | None = None,
) -> dict:
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=12.0)
    try:
        token = access_token or await get_access_token(client)
        response = await client.get(
            f"{API_BASE}/v1/billing/subscriptions/{subscription_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.status_code == 404:
            raise PayPalAPIError("PayPal subscription was not found", status_code=400)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Unexpected subscription response")
        return payload
    except PayPalAPIError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise PayPalAPIError("PayPal subscription lookup is temporarily unavailable") from exc
    finally:
        if owns_client:
            await client.aclose()


async def verify_webhook_signature(headers, event: dict) -> bool:
    if not PAYPAL_WEBHOOK_ID:
        raise PayPalAPIError("PAYPAL_WEBHOOK_ID is not configured")

    required = {
        "auth_algo": headers.get("PAYPAL-AUTH-ALGO"),
        "cert_url": headers.get("PAYPAL-CERT-URL"),
        "transmission_id": headers.get("PAYPAL-TRANSMISSION-ID"),
        "transmission_sig": headers.get("PAYPAL-TRANSMISSION-SIG"),
        "transmission_time": headers.get("PAYPAL-TRANSMISSION-TIME"),
    }
    if not all(required.values()):
        return False

    async with httpx.AsyncClient(timeout=12.0) as client:
        token = await get_access_token(client)
        try:
            response = await client.post(
                f"{API_BASE}/v1/notifications/verify-webhook-signature",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    **required,
                    "webhook_id": PAYPAL_WEBHOOK_ID,
                    "webhook_event": event,
                },
            )
            response.raise_for_status()
            return response.json().get("verification_status") == "SUCCESS"
        except (httpx.HTTPError, ValueError) as exc:
            raise PayPalAPIError("PayPal webhook verification is temporarily unavailable") from exc


async def cancel_subscription(subscription_id: str, *, reason: str) -> None:
    """Cancel an active PayPal subscription before destructive account deletion."""
    async with httpx.AsyncClient(timeout=12.0) as client:
        token = await get_access_token(client)
        try:
            response = await client.post(
                f"{API_BASE}/v1/billing/subscriptions/{subscription_id}/cancel",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"reason": reason[:128]},
            )
            # An already-absent provider record is an idempotent outcome.
            if response.status_code not in {204, 404}:
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise PayPalAPIError("PayPal cancellation is temporarily unavailable") from exc
