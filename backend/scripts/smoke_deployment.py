"""Read-only smoke checks for a deployed frontend/API pair."""
import argparse
import asyncio
import re
import sys
from urllib.parse import urlparse

import httpx
import websockets


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def _secure_url(value: str, expected_scheme: str, allow_http: bool) -> str:
    clean = value.strip().rstrip("/")
    parsed = urlparse(clean)
    allowed = {expected_scheme}
    if allow_http:
        allowed.add("http" if expected_scheme == "https" else "ws")
    if parsed.scheme not in allowed or not parsed.netloc:
        raise ValueError(f"{clean!r} must use {expected_scheme}")
    return clean


async def run(api_base: str, frontend_base: str, allow_http: bool = False) -> list[str]:
    failures: list[str] = []
    api_base = _secure_url(api_base, "https", allow_http)
    frontend_base = _secure_url(frontend_base, "https", allow_http)
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for path, expected_status in (("/health/live", "alive"), ("/health/ready", "ready")):
            response = await client.get(f"{api_base}{path}", headers={"X-Request-ID": "smoke-release-check"})
            if response.status_code != 200:
                failures.append(f"API {path} returned {response.status_code}")
                continue
            payload = response.json()
            if payload.get("status") != expected_status:
                failures.append(f"API {path} did not report status={expected_status}")
            if not REQUEST_ID_PATTERN.fullmatch(response.headers.get("x-request-id", "")):
                failures.append(f"API {path} did not return a valid X-Request-ID")

        legal = await client.get(f"{api_base}/legal/documents")
        if legal.status_code != 200 or not {"privacy_notice_version", "terms_version", "minimum_age"}.issubset(legal.json()):
            failures.append("API legal-document contract is unavailable")
        unauthorized = await client.get(f"{api_base}/me")
        if unauthorized.status_code != 401:
            failures.append(f"Protected /me returned {unauthorized.status_code} without authentication")
        preflight = await client.options(
            f"{api_base}/login",
            headers={
                "Origin": frontend_base,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        if preflight.headers.get("access-control-allow-origin") != frontend_base:
            failures.append("API CORS does not allow the configured frontend origin")
        if preflight.headers.get("access-control-allow-credentials") != "true":
            failures.append("API CORS does not allow credentialed refresh sessions")

        required_headers = {
            "content-security-policy", "strict-transport-security", "x-frame-options",
            "x-content-type-options", "referrer-policy", "permissions-policy",
        }
        for path in ("/", "/register", "/privacy", "/terms"):
            response = await client.get(f"{frontend_base}{path}")
            if response.status_code != 200 or "text/html" not in response.headers.get("content-type", ""):
                failures.append(f"Frontend {path} did not return the SPA shell")
            if path == "/" and not allow_http:
                missing = required_headers - {name.lower() for name in response.headers}
                if missing:
                    failures.append("Frontend is missing security headers: " + ", ".join(sorted(missing)))

    ws_scheme = "ws" if api_base.startswith("http://") else "wss"
    ws_url = f"{ws_scheme}://{urlparse(api_base).netloc}/ws/train"
    try:
        async with websockets.connect(ws_url, open_timeout=10) as socket:
            await socket.send('{"type":"authenticate"}')
            try:
                await asyncio.wait_for(socket.recv(), timeout=10)
                failures.append("Training WebSocket accepted an empty authentication token")
            except websockets.exceptions.ConnectionClosed as exc:
                if exc.code != 1008:
                    failures.append(f"Unauthenticated WebSocket closed with code {exc.code}, expected 1008")
    except websockets.exceptions.InvalidStatus as exc:
        if exc.response.status_code not in {401, 403}:
            failures.append(f"Unauthenticated WebSocket returned {exc.response.status_code}")
    except (OSError, asyncio.TimeoutError) as exc:
        failures.append(f"WebSocket endpoint was unreachable: {type(exc).__name__}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--frontend-base", required=True)
    parser.add_argument("--allow-http", action="store_true", help="Allow local HTTP/WS rehearsal")
    args = parser.parse_args()
    try:
        failures = asyncio.run(run(args.api_base, args.frontend_base, args.allow_http))
    except (ValueError, httpx.HTTPError) as exc:
        print(f"Smoke check could not run: {exc}", file=sys.stderr)
        return 2
    if failures:
        print("Deployment smoke check failed:\n- " + "\n- ".join(failures), file=sys.stderr)
        return 1
    print("Deployment smoke check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
