import hashlib
import json
import zlib
from datetime import datetime, timezone

from services.tape_storage import download_tape, parse_and_validate_tape


def iso(value):
    return value.isoformat() if value else None


def decode_tape(tape):
    if not tape:
        return None
    if getattr(tape, "storage_provider", "database") == "azure":
        document, digest = parse_and_validate_tape(download_tape(tape.blob_name))
        if digest != tape.content_sha256:
            raise ValueError("Stored tape checksum mismatch")
    else:
        document = json.loads(zlib.decompress(tape.payload).decode("utf-8"))
    return {
        "version": tape.version,
        "frame_rate": tape.frame_rate,
        "frame_count": tape.frame_count,
        "duration_ms": tape.duration_ms,
        "codec": tape.codec,
        "created_at": iso(tape.created_at),
        "updated_at": iso(tape.updated_at),
        "document": document,
    }


def stable_sha256(value):
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_research_export(
    *, practice_sessions, practice_reps, practice_analytics, practice_tapes,
    training_sessions, training_steps, feedback_events, include_tapes=True,
    participant_id="P001", technique_name="Jab", generated_at=None,
):
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    reps_by_session = {}
    for rep in practice_reps:
        reps_by_session.setdefault(rep.practice_session_id, []).append({
            "rep_number": rep.rep_number,
            "accuracy": rep.accuracy,
            "duration_ms": rep.duration_ms,
            "speed_label": rep.speed_label,
            "quality_label": rep.quality_label,
            "focus_body_part": rep.focus_body_part,
            "issue": rep.issue,
            "started_at": iso(rep.started_at),
            "ended_at": iso(rep.ended_at),
        })

    practice = []
    for session in practice_sessions:
        item = {
            "session_id": f"practice-{session.id}",
            "technique_name": session.technique_name,
            "step_key": session.step_key,
            "step_name": session.step_name,
            "target_reps": session.target_reps,
            "completed_reps": session.completed_reps,
            "clean_reps": session.clean_reps,
            "average_accuracy": session.average_accuracy,
            "best_accuracy": session.best_accuracy,
            "average_rep_seconds": session.average_rep_seconds,
            "consistency_score": session.consistency_score,
            "status": session.status,
            "started_at": iso(session.started_at),
            "ended_at": iso(session.ended_at),
            "repetitions": sorted(reps_by_session.get(session.id, []), key=lambda row: row["rep_number"]),
            "analytics": practice_analytics.get(session.id) or {},
        }
        tape = practice_tapes.get(session.id)
        if tape:
            item["tape_metadata"] = {
                "version": tape.version,
                "frame_rate": tape.frame_rate,
                "frame_count": tape.frame_count,
                "duration_ms": tape.duration_ms,
                "compressed_bytes": tape.compressed_bytes,
                "uncompressed_bytes": tape.uncompressed_bytes,
                "storage_provider": getattr(tape, "storage_provider", "database"),
                "content_sha256": getattr(tape, "content_sha256", None),
                "capture_source": getattr(tape, "capture_source", "device_estimate"),
                "algorithm_version": getattr(tape, "algorithm_version", None),
                "config_version": getattr(tape, "config_version", None),
            }
            if include_tapes:
                item["tape"] = decode_tape(tape)
        practice.append(item)

    steps_by_session, feedback_by_session = {}, {}
    for step in training_steps:
        steps_by_session.setdefault(step.session_id, []).append({
            "step_key": step.step_key,
            "step_name": step.step_name,
            "best_accuracy": step.best_accuracy,
            "average_accuracy": step.average_accuracy,
            "attempts_count": step.attempts_count,
            "completed_at": iso(step.completed_at),
        })
    for event in feedback_events:
        feedback_by_session.setdefault(event.session_id, []).append({
            "step_key": event.step_key,
            "body_part": event.body_part,
            "issue": event.issue,
            "feedback_text": event.feedback_text,
            "accuracy": event.accuracy,
            "created_at": iso(event.created_at),
        })
    training = [{
        "session_id": f"training-{session.id}",
        "technique_name": session.technique_name,
        "mode": session.mode,
        "started_at": iso(session.started_at),
        "ended_at": iso(session.ended_at),
        "final_accuracy": session.final_accuracy,
        "completed": bool(session.completed),
        "step_attempts": steps_by_session.get(session.id, []),
        "feedback_events": feedback_by_session.get(session.id, []),
    } for session in training_sessions]

    document = {
        "schema": "combat-cognition-research-export/v1",
        "generated_at": generated_at,
        "participant_id": participant_id,
        "scope": {
            "design": "single_participant_expert_feasibility_case",
            "technique": technique_name,
            "raw_video_included": False,
            "account_identity_included": False,
            "tapes_included": include_tapes,
        },
        "practice_sessions": practice,
        "training_sessions": training,
        "limitations": [
            "Researcher, developer, participant, and expert roles overlap.",
            "Single-participant jab evidence is not population-generalizable.",
            "Database scores are system outputs, not independent ground truth.",
            "Practice tape measurements are device-generated coaching estimates.",
        ],
    }
    document["content_sha256"] = stable_sha256(document)
    return document
