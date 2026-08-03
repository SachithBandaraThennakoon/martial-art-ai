from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import PurePosixPath
import re
import secrets

from fastapi import HTTPException

from utils.security import APP_ENV


TAPE_STORAGE_MODE = os.getenv(
    "TAPE_STORAGE_MODE", "azure" if APP_ENV == "production" else "database"
).strip().lower()
TAPE_STORAGE_ACCOUNT_URL = os.getenv("TAPE_STORAGE_ACCOUNT_URL", "").strip().rstrip("/")
TAPE_STORAGE_CONTAINER = os.getenv("TAPE_STORAGE_CONTAINER", "practice-tapes").strip()
TAPE_MAX_BYTES = max(1024 * 1024, int(os.getenv("TAPE_MAX_BYTES", str(16 * 1024 * 1024))))
TAPE_MAX_FRAMES = max(30, min(int(os.getenv("TAPE_MAX_FRAMES", "9000")), 18000))
TAPE_RETENTION_DAYS = max(1, int(os.getenv("TAPE_RETENTION_DAYS", "90")))

if TAPE_STORAGE_MODE not in {"database", "azure"}:
    raise RuntimeError("TAPE_STORAGE_MODE must be database or azure")
if APP_ENV == "production" and TAPE_STORAGE_MODE != "azure":
    raise RuntimeError("Production requires TAPE_STORAGE_MODE=azure")
if TAPE_STORAGE_MODE == "azure" and not TAPE_STORAGE_ACCOUNT_URL:
    raise RuntimeError("TAPE_STORAGE_ACCOUNT_URL is required for Azure tape storage")
if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?", TAPE_STORAGE_CONTAINER):
    raise RuntimeError("TAPE_STORAGE_CONTAINER is not a valid Azure container name")


FRAME_KEYS = {
    "t", "st", "n", "r", "s", "a", "f", "i", "w", "p", "op", "wp", "ap",
    "av", "ss", "tc", "ds", "face", "fs", "hl", "hr", "cq", "ct", "ao", "at",
    "mp", "ph", "tp", "cf", "tr", "pc", "pe", "pf", "pcf", "fa", "lr", "ls",
    "lph", "ltp", "es", "ms", "mk", "nr", "dr", "qs", "ps", "sc", "rc",
}
METADATA_KEYS = {
    "sessionId", "targetReps", "countGapMs", "techniqueName", "biomechanicsSchema",
    "postSessionClassification", "frameOrganizationVersion", "clusteredCompletedReps",
    "completionStatus", "completedReps", "correctedSummary", "captureWindow",
    "captureMarginsMs", "steps", "authoritativeSession", "ruleEngineAnalysis",
    "captureDurationMs", "canonicalCompletedReps", "canonicalTargetReps",
    "algorithmVersion", "configVersion", "deviceGeneratedEstimate",
}


@dataclass(frozen=True)
class TapeBlobProperties:
    size: int
    content_type: str | None
    sha256: str
    document: dict


def retention_expiry() -> datetime:
    return (datetime.now(timezone.utc) + timedelta(days=TAPE_RETENTION_DAYS)).replace(tzinfo=None)


def _validate_tree(value, *, depth=0, count=None):
    if count is None:
        count = [0]
    count[0] += 1
    if count[0] > 20000 or depth > 6:
        raise HTTPException(status_code=422, detail="Tape metadata is too complex")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or abs(value) > 1_000_000_000:
            raise HTTPException(status_code=422, detail="Tape contains an invalid number")
        return
    if isinstance(value, str):
        if len(value) > 256:
            raise HTTPException(status_code=422, detail="Tape contains an oversized label")
        return
    if isinstance(value, list):
        if len(value) > 512:
            raise HTTPException(status_code=422, detail="Tape contains an oversized collection")
        for item in value:
            _validate_tree(item, depth=depth + 1, count=count)
        return
    if isinstance(value, dict):
        if len(value) > 128:
            raise HTTPException(status_code=422, detail="Tape contains too many fields")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 96:
                raise HTTPException(status_code=422, detail="Tape contains an invalid field name")
            _validate_tree(item, depth=depth + 1, count=count)
        return
    raise HTTPException(status_code=422, detail="Tape contains an unsupported value")


def validate_tape_document(document: dict) -> None:
    if not isinstance(document, dict) or set(document) - {
        "version", "frame_rate", "duration_ms", "frames", "metadata"
    }:
        raise HTTPException(status_code=422, detail="Tape document fields are invalid")
    version = document.get("version")
    frame_rate = document.get("frame_rate")
    duration_ms = document.get("duration_ms")
    frames = document.get("frames")
    metadata = document.get("metadata")
    if not isinstance(version, int) or not 1 <= version <= 3:
        raise HTTPException(status_code=422, detail="Tape version is invalid")
    if not isinstance(frame_rate, int) or not 1 <= frame_rate <= 60:
        raise HTTPException(status_code=422, detail="Tape frame rate is invalid")
    if not isinstance(duration_ms, int) or not 0 <= duration_ms <= 900_000:
        raise HTTPException(status_code=422, detail="Tape duration is invalid")
    if not isinstance(frames, list) or not 1 <= len(frames) <= TAPE_MAX_FRAMES:
        raise HTTPException(status_code=422, detail="Tape frame count is invalid")
    if not isinstance(metadata, dict) or set(metadata) - METADATA_KEYS:
        raise HTTPException(status_code=422, detail="Tape metadata fields are invalid")

    previous_time = -1
    for frame in frames:
        if not isinstance(frame, dict) or set(frame) - FRAME_KEYS:
            raise HTTPException(status_code=422, detail="Tape frame fields are invalid")
        elapsed = frame.get("t")
        if not isinstance(elapsed, int) or elapsed < previous_time or elapsed > duration_ms + 2000:
            raise HTTPException(status_code=422, detail="Tape frame timestamps are invalid")
        previous_time = elapsed
        for key in ("p", "op", "wp", "ap"):
            points = frame.get(key) or []
            if not isinstance(points, list) or len(points) > 33:
                raise HTTPException(status_code=422, detail="Tape pose landmarks are invalid")
            if any(not isinstance(point, list) or len(point) != 4 for point in points):
                raise HTTPException(status_code=422, detail="Tape pose landmark shape is invalid")
            if any(
                value is not None and (not isinstance(value, int) or abs(value) > 100_000)
                for point in points for value in point
            ):
                raise HTTPException(status_code=422, detail="Tape pose landmark values are invalid")
        for key, maximum in (("face", 478), ("hl", 21), ("hr", 21)):
            points = frame.get(key) or []
            if not isinstance(points, list) or len(points) > maximum:
                raise HTTPException(status_code=422, detail="Tape detail landmarks are invalid")
            if any(not isinstance(point, list) or len(point) != 3 for point in points):
                raise HTTPException(status_code=422, detail="Tape detail landmark shape is invalid")
            if any(
                value is not None and (not isinstance(value, int) or abs(value) > 100_000)
                for point in points for value in point
            ):
                raise HTTPException(status_code=422, detail="Tape detail landmark values are invalid")
        _validate_tree(frame)
    _validate_tree(metadata)


def parse_and_validate_tape(raw: bytes) -> tuple[dict, str]:
    if len(raw) > TAPE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Practice tape exceeds the upload limit")
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Practice tape must be valid JSON") from exc
    validate_tape_document(document)
    return document, hashlib.sha256(raw).hexdigest()


def new_blob_name(user_id: int, session_id: int) -> str:
    token = secrets.token_urlsafe(18)
    return str(PurePosixPath("users", str(user_id), "sessions", str(session_id), f"{token}.json"))


def _azure_clients():
    try:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient
    except ImportError as exc:
        raise RuntimeError("Azure tape-storage dependencies are not installed") from exc
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    service = BlobServiceClient(TAPE_STORAGE_ACCOUNT_URL, credential=credential)
    return credential, service


def create_upload_url(blob_name: str, *, expected_sha256: str) -> tuple[str, datetime]:
    from azure.storage.blob import BlobSasPermissions, generate_blob_sas

    _credential, service = _azure_clients()
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=10)
    delegation_key = service.get_user_delegation_key(now - timedelta(minutes=5), expiry)
    account_name = TAPE_STORAGE_ACCOUNT_URL.split("//", 1)[-1].split(".", 1)[0]
    sas = generate_blob_sas(
        account_name=account_name,
        container_name=TAPE_STORAGE_CONTAINER,
        blob_name=blob_name,
        user_delegation_key=delegation_key,
        permission=BlobSasPermissions(create=True),
        start=now - timedelta(minutes=5),
        expiry=expiry,
        protocol="https",
    )
    blob = service.get_blob_client(TAPE_STORAGE_CONTAINER, blob_name)
    return f"{blob.url}?{sas}", expiry


def verify_uploaded_blob(blob_name: str, expected_size: int, expected_sha256: str) -> TapeBlobProperties:
    _credential, service = _azure_clients()
    blob = service.get_blob_client(TAPE_STORAGE_CONTAINER, blob_name)
    properties = blob.get_blob_properties()
    content_type = properties.content_settings.content_type
    if properties.size != expected_size or properties.size > TAPE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="Uploaded tape size does not match the intent")
    if content_type != "application/json":
        raise HTTPException(status_code=422, detail="Uploaded tape content type is invalid")
    digest = hashlib.sha256()
    payload = bytearray()
    total = 0
    for chunk in blob.download_blob(max_concurrency=1).chunks():
        total += len(chunk)
        if total > TAPE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded tape exceeds the limit")
        digest.update(chunk)
        payload.extend(chunk)
    actual_sha256 = digest.hexdigest()
    if total != expected_size or actual_sha256 != expected_sha256:
        raise HTTPException(status_code=422, detail="Uploaded tape checksum verification failed")
    document, _digest = parse_and_validate_tape(bytes(payload))
    return TapeBlobProperties(total, content_type, actual_sha256, document)


def download_tape(blob_name: str) -> bytes:
    _credential, service = _azure_clients()
    blob = service.get_blob_client(TAPE_STORAGE_CONTAINER, blob_name)
    raw = blob.download_blob(max_concurrency=1).readall()
    if len(raw) > TAPE_MAX_BYTES:
        raise HTTPException(status_code=500, detail="Stored tape exceeds the configured limit")
    return raw


def delete_tape_blob(blob_name: str) -> None:
    _credential, service = _azure_clients()
    blob = service.get_blob_client(TAPE_STORAGE_CONTAINER, blob_name)
    try:
        blob.delete_blob(delete_snapshots="include")
    except Exception as exc:
        try:
            from azure.core.exceptions import ResourceNotFoundError
        except ImportError:
            ResourceNotFoundError = ()
        if not isinstance(exc, ResourceNotFoundError):
            raise
