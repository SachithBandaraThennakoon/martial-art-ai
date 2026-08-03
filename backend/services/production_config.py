"""Fail-fast validation for settings that must be correct before production starts."""
from collections.abc import Mapping
from urllib.parse import urlparse
import os


PLACEHOLDER_MARKERS = ("your_", "your-", "replace", "<secret>", "example.com", "localhost")


def _value(env: Mapping[str, str], name: str) -> str:
    return str(env.get(name, "")).strip()


def _configured(env: Mapping[str, str], name: str) -> bool:
    value = _value(env, name)
    lowered = value.lower()
    return bool(value) and not any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def _https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and not parsed.username


def production_configuration_errors(env: Mapping[str, str]) -> list[str]:
    if _value(env, "APP_ENV").lower() != "production":
        return []

    errors: list[str] = []
    for name in (
        "APP_VERSION", "DATABASE_URL", "SECRET_KEY", "RATE_LIMIT_HASH_KEY",
        "APPLICATIONINSIGHTS_CONNECTION_STRING", "FRONTEND_URL", "CORS_ORIGINS",
        "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID",
        "PAYPAL_STARTER_PLAN_ID", "PAYPAL_PRO_PLAN_ID", "PAYPAL_ELITE_PLAN_ID",
        "TAPE_STORAGE_ACCOUNT_URL", "TAPE_STORAGE_CONTAINER",
    ):
        if not _configured(env, name):
            errors.append(f"{name} is required and must not contain a placeholder")

    database_url = _value(env, "DATABASE_URL")
    if database_url and not database_url.startswith(("postgresql://", "postgresql+psycopg2://")):
        errors.append("DATABASE_URL must use PostgreSQL in production")
    if database_url and "sslmode=require" not in database_url.lower():
        errors.append("DATABASE_URL must include sslmode=require in production")

    secret_key = _value(env, "SECRET_KEY")
    rate_key = _value(env, "RATE_LIMIT_HASH_KEY")
    if len(secret_key) < 32:
        errors.append("SECRET_KEY must contain at least 32 characters")
    if len(rate_key) < 32:
        errors.append("RATE_LIMIT_HASH_KEY must contain at least 32 characters")
    if secret_key and secret_key == rate_key:
        errors.append("SECRET_KEY and RATE_LIMIT_HASH_KEY must be different")

    frontend_url = _value(env, "FRONTEND_URL").rstrip("/")
    if frontend_url and not _https_url(frontend_url):
        errors.append("FRONTEND_URL must be an HTTPS origin without credentials")
    origins = [origin.strip().rstrip("/") for origin in _value(env, "CORS_ORIGINS").split(",") if origin.strip()]
    if any(origin == "*" or not _https_url(origin) for origin in origins):
        errors.append("CORS_ORIGINS must contain only explicit HTTPS origins")
    if frontend_url and frontend_url not in origins:
        errors.append("FRONTEND_URL must be included in CORS_ORIGINS")

    if _value(env, "PAYPAL_MODE").lower() != "live":
        errors.append("PAYPAL_MODE must be live in production")
    plan_ids = [_value(env, name) for name in ("PAYPAL_STARTER_PLAN_ID", "PAYPAL_PRO_PLAN_ID", "PAYPAL_ELITE_PLAN_ID")]
    if all(plan_ids) and len(set(plan_ids)) != len(plan_ids):
        errors.append("PayPal production plan IDs must be unique")

    if _value(env, "TAPE_STORAGE_MODE").lower() != "azure":
        errors.append("TAPE_STORAGE_MODE must be azure in production")
    storage_url = _value(env, "TAPE_STORAGE_ACCOUNT_URL")
    if storage_url and not _https_url(storage_url):
        errors.append("TAPE_STORAGE_ACCOUNT_URL must be HTTPS")

    email_provider = _value(env, "EMAIL_PROVIDER").lower()
    if email_provider == "azure":
        for name in ("AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING", "AZURE_EMAIL_SENDER"):
            if not _configured(env, name):
                errors.append(f"{name} is required for EMAIL_PROVIDER=azure")
    elif email_provider == "resend":
        for name in ("RESEND_API_KEY", "PASSWORD_RESET_FROM_EMAIL"):
            if not _configured(env, name):
                errors.append(f"{name} is required for EMAIL_PROVIDER=resend")
    else:
        errors.append("EMAIL_PROVIDER must be azure or resend in production")

    return errors


def validate_runtime_environment(env: Mapping[str, str] | None = None) -> None:
    errors = production_configuration_errors(env or os.environ)
    if errors:
        raise RuntimeError("Invalid production configuration:\n- " + "\n- ".join(errors))
