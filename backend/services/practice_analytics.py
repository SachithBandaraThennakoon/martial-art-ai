import json
import zlib


ANALYTICS_SCHEMA_VERSION = 3


def _number(value, default=0):
    try:
        result = float(value)
        return result if result == result else default
    except (TypeError, ValueError):
        return default


def _integer(value, default=0):
    return int(round(_number(value, default)))


def extract_practice_analytics(metadata):
    metadata = metadata if isinstance(metadata, dict) else {}
    rule_analysis = metadata.get("ruleEngineAnalysis")
    rule_analysis = rule_analysis if isinstance(rule_analysis, dict) else {}
    rule_summary = rule_analysis.get("summary")
    rule_summary = rule_summary if isinstance(rule_summary, dict) else {}
    corrected = metadata.get("correctedSummary")
    corrected = corrected if isinstance(corrected, dict) else {}

    errors = []
    for item in rule_summary.get("common_form_errors") or []:
        if isinstance(item, dict) and item.get("error_id"):
            errors.append({
                "error_id": str(item["error_id"])[:120],
                "count": max(0, _integer(item.get("count"))),
            })

    step_durations = {
        str(key)[:120]: max(0, _integer(value))
        for key, value in (rule_summary.get("per_step_duration_ms") or {}).items()
        if isinstance(key, (str, int))
    }

    corrected_completed = metadata.get(
        "canonicalCompletedReps",
        corrected.get("completed_reps"),
    )
    completed_repetitions = max(
        0,
        _integer(
            corrected_completed
            if corrected_completed is not None
            else rule_summary.get("completed_repetitions")
        ),
    )
    target_repetitions = metadata.get(
        "canonicalTargetReps",
        metadata.get("targetReps"),
    )
    aborted_repetitions = (
        max(0, _integer(target_repetitions) - completed_repetitions)
        if target_repetitions is not None
        else max(0, _integer(rule_summary.get("aborted_repetitions")))
    )

    return {
        "schema_version": ANALYTICS_SCHEMA_VERSION,
        "source": "post_session_rule_engine",
        "completed_repetitions": completed_repetitions,
        "aborted_repetitions": aborted_repetitions,
        "average_response_time_ms": (
            max(0, _integer(rule_summary.get("average_response_time_ms")))
            if rule_summary.get("average_response_time_ms") is not None
            else None
        ),
        "tracking_quality_percentage": (
            max(
                0,
                min(
                    100,
                    round(_number(rule_summary.get("tracking_quality_percentage")), 1),
                ),
            )
            if rule_summary.get("tracking_quality_percentage") is not None
            else None
        ),
        "common_form_errors": errors,
        "per_step_duration_ms": step_durations,
        "corrections_applied": max(
            0, _integer(rule_summary.get("corrections_applied"))
        ),
        "capture_duration_ms": max(
            0, _integer(metadata.get("captureDurationMs"))
        ),
    }


def upsert_practice_analytics(db, session_id, metadata):
    from models.training_memory import PracticeSessionAnalytics

    payload = extract_practice_analytics(metadata)
    record = db.query(PracticeSessionAnalytics).filter(
        PracticeSessionAnalytics.practice_session_id == session_id
    ).first()
    if not record:
        record = PracticeSessionAnalytics(
            practice_session_id=session_id,
            payload="{}",
        )
        db.add(record)
    record.schema_version = ANALYTICS_SCHEMA_VERSION
    record.payload = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return payload


def _decode_payload(record):
    try:
        payload = json.loads(record.payload)
        return payload if isinstance(payload, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def load_practice_analytics(db, session_ids):
    from models.training_memory import (
        PracticeSession,
        PracticeSessionAnalytics,
        PracticeSessionTape,
    )

    ids = [int(value) for value in session_ids if value is not None]
    if not ids:
        return {}

    records = db.query(PracticeSessionAnalytics).filter(
        PracticeSessionAnalytics.practice_session_id.in_(ids)
    ).all()
    result = {
        record.practice_session_id: _decode_payload(record)
        for record in records
        if record.schema_version >= ANALYTICS_SCHEMA_VERSION
    }

    missing_ids = [session_id for session_id in ids if session_id not in result]
    if not missing_ids:
        return result

    tapes = db.query(PracticeSessionTape).filter(
        PracticeSessionTape.practice_session_id.in_(missing_ids)
    ).order_by(PracticeSessionTape.updated_at.desc()).limit(50).all()
    canonical_sessions = {
        session.id: session
        for session in db.query(PracticeSession).filter(
            PracticeSession.id.in_([tape.practice_session_id for tape in tapes])
        ).all()
    }
    backfilled = False
    for tape in tapes:
        try:
            document = json.loads(zlib.decompress(tape.payload).decode("utf-8"))
            canonical_session = canonical_sessions.get(tape.practice_session_id)
            metadata = {
                **(document.get("metadata") or {}),
                "captureDurationMs": document.get("duration_ms") or 0,
                "canonicalCompletedReps": (
                    canonical_session.completed_reps
                    if canonical_session is not None
                    else None
                ),
                "canonicalTargetReps": (
                    canonical_session.target_reps
                    if canonical_session is not None
                    else None
                ),
            }
            result[tape.practice_session_id] = upsert_practice_analytics(
                db,
                tape.practice_session_id,
                metadata,
            )
            backfilled = True
        except (zlib.error, UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            result[tape.practice_session_id] = {}
    if backfilled:
        db.commit()
    return result
