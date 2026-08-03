from datetime import date, datetime, timezone
import json


PRIVACY_NOTICE_VERSION = "2026-08-03"
TERMS_VERSION = "2026-08-03"
AGE_POLICY_VERSION = "2026-08-03"
MINIMUM_AGE = 18
EXPORT_SCHEMA_VERSION = "account-export/v1"


def legal_documents_payload() -> dict:
    return {
        "privacy_notice_version": PRIVACY_NOTICE_VERSION,
        "terms_version": TERMS_VERSION,
        "age_policy_version": AGE_POLICY_VERSION,
        "minimum_age": MINIMUM_AGE,
    }


def model_payload(record, *, exclude=()) -> dict:
    excluded = set(exclude)
    return {
        column.name: value.isoformat() if isinstance(value := getattr(record, column.name), (datetime, date)) else value
        for column in record.__table__.columns
        if column.name not in excluded and not isinstance(getattr(record, column.name), bytes)
    }


def parsed_json(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


def generated_at() -> str:
    return datetime.now(timezone.utc).isoformat()
