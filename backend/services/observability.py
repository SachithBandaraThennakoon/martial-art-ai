from contextvars import ContextVar
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import logging
import os
import re
import sys
import uuid


_request_id = ContextVar("request_id", default="-")
_configured = False


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        return True


class RedactionFilter(logging.Filter):
    PATTERNS = (
        (re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~-]+"), "Bearer [REDACTED]"),
        (re.compile(r"(?i)((?:token|code|sig|signature))=([^&\s]+)"), r"\1=[REDACTED]"),
        (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED_EMAIL]"),
        (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "[REDACTED_TOKEN]"),
    )

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for pattern, replacement in self.PATTERNS:
            message = pattern.sub(replacement, message)
        record.msg = message
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    SAFE_FIELDS = (
        "event", "method", "route", "status_code", "duration_ms",
        "error_type", "component", "outcome",
    )

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for field in self.SAFE_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def configure_observability() -> None:
    global _configured
    if _configured:
        return
    _configured = True
    level_name = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactionFilter())
    handler.addFilter(RequestContextFilter())
    if os.getenv("APP_ENV", "development").strip().lower() == "production":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s [%(request_id)s] %(message)s")
        )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "").strip()
    if connection_string:
        try:
            from azure.monitor.opentelemetry import configure_azure_monitor

            configure_azure_monitor(
                connection_string=connection_string,
                disable_offline_storage=True,
                enable_live_metrics=True,
                instrumentation_options={
                    # These automatic integrations may export full inbound or
                    # outbound URLs. The application emits its own route-only
                    # HTTP spans and metrics so signed/token query values never
                    # enter telemetry.
                    "azure_sdk": {"enabled": False},
                    "fastapi": {"enabled": False},
                    "psycopg2": {"enabled": False},
                    "requests": {"enabled": False},
                    "urllib": {"enabled": False},
                    "urllib3": {"enabled": False},
                },
            )
            logging.getLogger(__name__).info(
                "Azure Monitor telemetry enabled",
                extra={"event": "telemetry_enabled", "component": "azure_monitor"},
            )
        except Exception as exc:
            logging.getLogger(__name__).error(
                "Azure Monitor telemetry could not be configured",
                extra={
                    "event": "telemetry_configuration_failed",
                    "component": "azure_monitor",
                    "error_type": type(exc).__name__,
                },
            )
            if os.getenv("APP_ENV", "development").strip().lower() == "production":
                raise RuntimeError("Azure Monitor telemetry configuration failed") from exc


def request_id_from_header(value: str | None) -> str:
    candidate = (value or "").strip()
    if 8 <= len(candidate) <= 64 and all(character.isalnum() or character in "-_" for character in candidate):
        return candidate
    return uuid.uuid4().hex


def set_request_id(value: str):
    return _request_id.set(value)


def reset_request_id(token) -> None:
    _request_id.reset(token)


def request_id() -> str:
    return _request_id.get()


try:
    from opentelemetry import metrics, trace
    from opentelemetry.trace import Status, StatusCode

    _meter = metrics.get_meter("combat-cognition-api")
    _tracer = trace.get_tracer("combat-cognition-api")
    _request_counter = _meter.create_counter(
        "http.server.requests",
        unit="{request}",
        description="Completed application HTTP requests",
    )
    _request_duration = _meter.create_histogram(
        "http.server.duration",
        unit="ms",
        description="Application HTTP request duration",
    )
    _awareness_snapshots = _meter.create_counter(
        "awareness.snapshots", unit="{snapshot}", description="Processed awareness snapshots"
    )
    _awareness_duration = _meter.create_histogram(
        "awareness.processing.duration", unit="ms", description="Awareness processing duration"
    )
    _awareness_entities = _meter.create_histogram(
        "awareness.verified.entities", unit="{entity}", description="Verified entities per snapshot"
    )
except ImportError:
    _tracer = None
    _request_counter = None
    _request_duration = None
    _awareness_snapshots = None
    _awareness_duration = None
    _awareness_entities = None


@contextmanager
def http_request_span(method: str):
    if not _tracer:
        yield None
        return
    with _tracer.start_as_current_span(
        f"{method} request",
        record_exception=False,
        set_status_on_exception=False,
    ) as span:
        yield span


def finish_http_span(span, method: str, route: str, status_code: int, correlation_id: str) -> None:
    if span is None:
        return
    span.update_name(f"{method} {route}")
    span.set_attribute("http.request.method", method)
    span.set_attribute("http.route", route)
    span.set_attribute("http.response.status_code", status_code)
    span.set_attribute("http.request_id", correlation_id)
    if status_code >= 500:
        span.set_status(Status(StatusCode.ERROR))


def record_http_request(method: str, route: str, status_code: int, duration_ms: float) -> None:
    if not _request_counter or not _request_duration:
        return
    attributes = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": status_code,
    }
    _request_counter.add(1, attributes)
    _request_duration.record(duration_ms, attributes)


def record_awareness_snapshot(*, source: str, state: str, command: str, duration_ms: float, verified_entities: int) -> None:
    if not _awareness_snapshots or not _awareness_duration or not _awareness_entities:
        return
    attributes = {
        "awareness.source": source[:32],
        "awareness.state": state[:64],
        "awareness.command": command[:64],
    }
    _awareness_snapshots.add(1, attributes)
    _awareness_duration.record(duration_ms, attributes)
    _awareness_entities.record(verified_entities, {"awareness.source": source[:32]})
