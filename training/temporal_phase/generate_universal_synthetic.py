"""Generate a two-technique synthetic bootstrap bundle.

This data validates the universal training pipeline. It is not production
validation evidence and must eventually be supplemented with human recordings.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import uuid
from datetime import UTC, datetime
from pathlib import Path

from generate_synthetic_sequences import (
    FPS,
    base_pose,
    generate_session as generate_jab_session,
    quantize,
    smooth,
)

KICK_STATES = ("STANCE", "CHAMBER", "EXTENSION", "RECOIL", "RECOVERY")
LEGS = {
    "left": {"hip": 23, "knee": 25, "ankle": 27},
    "right": {"hip": 24, "knee": 26, "ankle": 28},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sessions-per-technique", type=int, default=24)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-reps", type=int, default=1)
    parser.add_argument("--max-reps", type=int, default=4)
    return parser.parse_args()


def kick_duration(state: str, speed: float, rng: random.Random) -> int:
    base = {
        "STANCE": 14,
        "CHAMBER": 7,
        "EXTENSION": 5,
        "RECOIL": 6,
        "RECOVERY": 11,
    }[state]
    return max(3, round(base * speed * rng.uniform(0.82, 1.18)))


def kick_amounts(state: str, progress: float) -> tuple[float, float]:
    eased = smooth(progress)
    if state == "STANCE":
        return 0.0, 0.0
    if state == "CHAMBER":
        return eased, 0.0
    if state == "EXTENSION":
        return 1.0, eased
    if state == "RECOIL":
        return 1.0, 1.0 - eased
    return 1.0 - eased, 0.0


def transform_kick_pose(
    source: list[list[float]],
    side: str,
    chamber: float,
    extension: float,
    yaw: float,
    noise: float,
    rng: random.Random,
    incorrect: bool,
) -> list[list[float]]:
    pose = [point[:] for point in source]
    kicking = LEGS[side]
    support = LEGS["right" if side == "left" else "left"]
    sign = -1 if side == "left" else 1
    hip = pose[kicking["hip"]][:3]
    stance_knee = pose[kicking["knee"]][:3]
    stance_ankle = pose[kicking["ankle"]][:3]
    chamber_knee = [hip[0] + sign * 0.02, hip[1] - 0.03, -0.27]
    chamber_ankle = [hip[0] - sign * 0.03, hip[1] + 0.13, -0.08]
    maximum = 0.62 if incorrect else 1.0
    extension = min(extension, maximum)
    extended_ankle = [hip[0] + sign * 0.02, hip[1] - 0.02, -0.67]
    knee = [
        stance_knee[index] + (chamber_knee[index] - stance_knee[index]) * chamber
        for index in range(3)
    ]
    ankle_chambered = [
        stance_ankle[index]
        + (chamber_ankle[index] - stance_ankle[index]) * chamber
        for index in range(3)
    ]
    ankle = [
        ankle_chambered[index]
        + (extended_ankle[index] - ankle_chambered[index]) * extension
        for index in range(3)
    ]
    pose[kicking["knee"]][:3] = knee
    pose[kicking["ankle"]][:3] = ankle
    pose[support["knee"]][0] *= 0.96
    pose[support["ankle"]][0] *= 0.96
    cosine, sine = math.cos(yaw), math.sin(yaw)
    for point in pose:
        x, y, z = point[:3]
        point[0] = x * cosine - z * sine + rng.gauss(0, noise)
        point[1] = y + rng.gauss(0, noise)
        point[2] = x * sine + z * cosine + rng.gauss(0, noise)
    return pose


def generate_front_kick_session(
    index: int,
    rng: random.Random,
    min_reps: int,
    max_reps: int,
) -> dict:
    side = rng.choice(("left", "right"))
    speed = rng.uniform(0.62, 1.55)
    yaw = rng.uniform(-0.38, 0.38)
    noise = rng.uniform(0.001, 0.008)
    reps = rng.randint(min_reps, max_reps)
    source = base_pose(rng)
    frames, segments = [], []
    timestamp = 0
    incomplete_rep = rng.randrange(reps) if rng.random() < 0.18 else -1
    incorrect_rep = rng.randrange(reps) if rng.random() < 0.28 else -1
    tracking_loss_at = rng.randrange(reps) if rng.random() < 0.14 else -1
    for rep_index in range(reps):
        states = list(KICK_STATES)
        if rep_index == incomplete_rep:
            states = ["STANCE", "CHAMBER", "RECOVERY"]
        for state in states:
            count = kick_duration(state, speed, rng)
            start = len(frames)
            has_loss = rep_index == tracking_loss_at and state == "EXTENSION"
            for state_frame in range(count):
                progress = state_frame / max(1, count - 1)
                chamber, extension = kick_amounts(state, progress)
                pose = transform_kick_pose(
                    source,
                    side,
                    chamber,
                    extension,
                    yaw,
                    noise,
                    rng,
                    rep_index == incorrect_rep,
                )
                lost = (
                    has_loss
                    and state_frame in {max(0, count // 2 - 1), count // 2}
                )
                if lost:
                    for point in pose:
                        point[3] = 0.05
                compact = quantize(pose)
                frames.append(
                    {
                        "t": timestamp,
                        "p": compact,
                        "op": compact,
                        "wp": compact,
                        "a": {},
                        "me": 0.0,
                        "tc": 0.08 if lost else round(rng.uniform(0.82, 0.99), 4),
                        "observation": "synthetic",
                    }
                )
                timestamp += round(1000 / FPS)
            end = len(frames) - 1
            if has_loss:
                lost_start = start + max(0, count // 2 - 1)
                lost_end = start + count // 2
                if lost_start > start:
                    segments.append(
                        {
                            "start_frame": start,
                            "end_frame": lost_start - 1,
                            "state": state,
                            "rep": rep_index + 1,
                        }
                    )
                segments.append(
                    {
                        "start_frame": lost_start,
                        "end_frame": lost_end,
                        "state": "__TRACKING_LOST__",
                        "rep": rep_index + 1,
                    }
                )
                if lost_end < end:
                    segments.append(
                        {
                            "start_frame": lost_end + 1,
                            "end_frame": end,
                            "state": state,
                            "rep": rep_index + 1,
                        }
                    )
            else:
                segments.append(
                    {
                        "start_frame": start,
                        "end_frame": end,
                        "state": state,
                        "rep": rep_index + 1,
                    }
                )
    return {
        "schema_version": "1.1",
        "session_id": f"synthetic-front-kick-{index:04d}-{uuid.uuid4().hex[:8]}",
        "source": "physics_synthetic_generator",
        "provenance": {
            "origin": "synthetic",
            "generator": "front-kick-v1",
            "seeded": True,
            "human_verified": False,
            "intended_use": "bootstrap_pretraining_only",
        },
        "technique_id": "front-kick",
        "technique_name": "Front Kick",
        "created_at": datetime.now(UTC).isoformat(),
        "duration_ms": frames[-1]["t"] if frames else 0,
        "nominal_fps": FPS,
        "capture": {"effective_fps": FPS, "complete_frame_grid": True},
        "variation": {
            "side": side,
            "speed_scale": round(speed, 4),
            "camera_yaw_radians": round(yaw, 4),
            "landmark_noise": round(noise, 5),
            "repetitions": reps,
            "has_incomplete_rep": incomplete_rep >= 0,
            "has_incorrect_form": incorrect_rep >= 0,
            "has_tracking_loss": tracking_loss_at >= 0,
        },
        "frames": frames,
        "manual_annotation": {
            "status": "synthetic_verified",
            "reviewed_at": None,
            "segments": segments,
        },
    }


def main() -> None:
    args = parse_args()
    if (
        args.sessions_per_technique < 4
        or args.min_reps < 1
        or args.max_reps < args.min_reps
    ):
        raise ValueError("Use at least 4 sessions and a valid repetition range")
    jab_rng = random.Random(args.seed)
    kick_rng = random.Random(args.seed + 10000)
    jab_sessions = [
        generate_jab_session(
            index + 1, jab_rng, args.min_reps, args.max_reps
        )
        for index in range(args.sessions_per_technique)
    ]
    kick_sessions = [
        generate_front_kick_session(
            index + 1, kick_rng, args.min_reps, args.max_reps
        )
        for index in range(args.sessions_per_technique)
    ]
    document = {
        "schema_version": "2.0",
        "dataset_type": "universal_physics_synthetic_bootstrap",
        "label_authority": "generator_state_machine",
        "generated_at": datetime.now(UTC).isoformat(),
        "warning": "Synthetic bootstrap data; never use as production test evidence.",
        "techniques": ["jab", "front-kick"],
        "sessions": jab_sessions + kick_sessions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, separators=(",", ":")), encoding="utf-8"
    )
    print(
        f"Wrote {len(jab_sessions)} Jab and {len(kick_sessions)} "
        f"Front Kick sessions to {args.output}"
    )


if __name__ == "__main__":
    main()
