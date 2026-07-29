"""Generate varied, physics-enriched bootstrap sequences.

Synthetic data is useful for pipeline development and pretraining. It must not
replace human-verified recordings for validation or production acceptance.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import uuid
from datetime import UTC, datetime
from pathlib import Path

FPS = 30
STATES = ("GUARD", "EXTENSION", "FULL_EXTENSION", "RETRACTION", "RECOVERY")
LEFT = {"shoulder": 11, "elbow": 13, "wrist": 15}
RIGHT = {"shoulder": 12, "elbow": 14, "wrist": 16}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sessions", type=int, default=60)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-reps", type=int, default=1)
    parser.add_argument("--max-reps", type=int, default=4)
    parser.add_argument("--technique-profile", default="jab-v1")
    return parser.parse_args()


def base_pose(rng: random.Random) -> list[list[float]]:
    shoulder = rng.uniform(0.16, 0.22)
    hip = rng.uniform(0.12, 0.17)
    torso = rng.uniform(0.25, 0.34)
    pose = [[0.0, 0.0, 0.0, 0.98] for _ in range(33)]
    pose[0][:3] = [0.0, 0.10, 0.0]
    pose[11][:3], pose[12][:3] = [-shoulder, 0.28, 0.0], [shoulder, 0.28, 0.0]
    pose[23][:3], pose[24][:3] = [-hip, 0.28 + torso, 0.0], [hip, 0.28 + torso, 0.0]
    pose[13][:3], pose[14][:3] = [-shoulder - 0.11, 0.40, -0.02], [shoulder + 0.11, 0.40, -0.02]
    pose[15][:3], pose[16][:3] = [-0.12, 0.33, -0.10], [0.12, 0.33, -0.10]
    pose[25][:3], pose[26][:3] = [-hip, 0.77, 0.0], [hip, 0.77, 0.0]
    pose[27][:3], pose[28][:3] = [-hip, 0.98, 0.02], [hip, 0.98, 0.02]
    for index in range(1, 11):
        pose[index][:3] = [(-0.03 if index % 2 else 0.03), 0.08 + index * 0.002, 0.0]
    for index in range(17, 23):
        pose[index][:3] = pose[15 if index % 2 else 16][:3]
    for index in range(29, 33):
        pose[index][:3] = pose[27 if index % 2 else 28][:3]
    return pose


def smooth(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def elbow_angle(shoulder: list[float], elbow: list[float], wrist: list[float]) -> float:
    first = [shoulder[i] - elbow[i] for i in range(3)]
    second = [wrist[i] - elbow[i] for i in range(3)]
    denominator = math.sqrt(sum(v * v for v in first) * sum(v * v for v in second))
    if denominator < 1e-8:
        return 0.0
    cosine = max(-1.0, min(1.0, sum(a * b for a, b in zip(first, second)) / denominator))
    return math.degrees(math.acos(cosine))


def transform_pose(
    source: list[list[float]],
    side: str,
    extension: float,
    yaw: float,
    noise: float,
    rng: random.Random,
    incorrect: bool,
) -> list[list[float]]:
    pose = [point[:] for point in source]
    lead = LEFT if side == "left" else RIGHT
    rear = RIGHT if side == "left" else LEFT
    sign = -1 if side == "left" else 1
    shoulder = pose[lead["shoulder"]][:3]
    guard = [sign * 0.12, 0.33, -0.10]
    maximum = 0.58 if incorrect else 1.0
    amount = min(extension, maximum)
    target = [sign * 0.08, 0.27, -0.62]
    wrist = [guard[i] + (target[i] - guard[i]) * amount for i in range(3)]
    elbow_guard = [sign * 0.29, 0.40, -0.02]
    elbow_extended = [
        (shoulder[0] + wrist[0]) * 0.5 + sign * 0.015 * (1 - amount),
        (shoulder[1] + wrist[1]) * 0.5 + 0.025 * (1 - amount),
        (shoulder[2] + wrist[2]) * 0.5 + 0.04 * (1 - amount),
    ]
    elbow = [
        elbow_guard[i] + (elbow_extended[i] - elbow_guard[i]) * amount
        for i in range(3)
    ]
    pose[lead["elbow"]][:3] = elbow
    pose[lead["wrist"]][:3] = wrist
    pose[rear["wrist"]][:3] = [sign * -0.12, 0.33, -0.10]
    cosine, sine = math.cos(yaw), math.sin(yaw)
    for point in pose:
        x, y, z = point[:3]
        point[0] = x * cosine - z * sine + rng.gauss(0, noise)
        point[1] = y + rng.gauss(0, noise)
        point[2] = x * sine + z * cosine + rng.gauss(0, noise)
    return pose


def quantize(pose: list[list[float]]) -> list[list[int]]:
    return [[round(value * 10000) for value in point] for point in pose]


def duration_frames(state: str, speed: float, rng: random.Random) -> int:
    base = {
        "GUARD": 12,
        "EXTENSION": 5,
        "FULL_EXTENSION": 3,
        "RETRACTION": 5,
        "RECOVERY": 9,
    }[state]
    return max(2, round(base * speed * rng.uniform(0.82, 1.18)))


def phase_extension(state: str, progress: float) -> float:
    if state == "GUARD":
        return 0.0
    if state == "EXTENSION":
        return 0.82 * smooth(progress)
    if state == "FULL_EXTENSION":
        return 0.82 + 0.18 * smooth(progress)
    if state == "RETRACTION":
        return 1.0 - 0.78 * smooth(progress)
    return 0.22 * (1.0 - smooth(progress))


def enrich_physics(frames: list[dict], side: str) -> None:
    lead = LEFT if side == "left" else RIGHT
    previous_velocity = 0.0
    previous_angle = None
    for index, frame in enumerate(frames):
        pose = [[value / 10000 for value in point] for point in frame["wp"]]
        angle = elbow_angle(
            pose[lead["shoulder"]][:3],
            pose[lead["elbow"]][:3],
            pose[lead["wrist"]][:3],
        )
        if index:
            previous = frames[index - 1]
            previous_pose = [[value / 10000 for value in point] for point in previous["wp"]]
            dt = max((frame["t"] - previous["t"]) / 1000.0, 1e-4)
            wrist_velocity = (
                pose[lead["wrist"]][2] - previous_pose[lead["wrist"]][2]
            ) / dt
            angular_velocity = (angle - (previous_angle or angle)) / dt
            acceleration = (wrist_velocity - previous_velocity) / dt
            motion = sum(
                math.dist(point[:3], prior[:3])
                for point, prior in zip(pose, previous_pose)
            ) / len(pose) / dt
        else:
            wrist_velocity = angular_velocity = acceleration = motion = 0.0
        frame["a"] = {
            "lead_elbow_angle": round(angle, 3),
            "lead_elbow_angular_velocity": round(angular_velocity, 3),
            "lead_wrist_forward_velocity": round(-wrist_velocity, 4),
        }
        frame["me"] = round(motion, 4)
        frame["ph"] = {
            "lead_wrist_forward_velocity": round(-wrist_velocity, 4),
            "lead_wrist_forward_acceleration": round(-acceleration, 4),
            "lead_elbow_angle": round(angle, 3),
            "lead_elbow_angular_velocity": round(angular_velocity, 3),
            "motion_energy": round(motion, 4),
        }
        previous_velocity = wrist_velocity
        previous_angle = angle


def generate_session(index: int, rng: random.Random, min_reps: int, max_reps: int) -> dict:
    side = rng.choice(("left", "right"))
    speed = rng.uniform(0.55, 1.65)
    yaw = rng.uniform(-0.42, 0.42)
    noise = rng.uniform(0.001, 0.009)
    reps = rng.randint(min_reps, max_reps)
    base = base_pose(rng)
    frames: list[dict] = []
    segments: list[dict] = []
    timestamp = 0
    incomplete_rep = rng.randrange(reps) if rng.random() < 0.18 else -1
    incorrect_rep = rng.randrange(reps) if rng.random() < 0.28 else -1
    tracking_loss_at = rng.randrange(reps) if rng.random() < 0.14 else -1
    for rep_index in range(reps):
        states = list(STATES)
        if rep_index == incomplete_rep:
            states = ["GUARD", "EXTENSION", "RECOVERY"]
        for state in states:
            count = duration_frames(state, speed, rng)
            start = len(frames)
            for state_frame in range(count):
                progress = state_frame / max(1, count - 1)
                extension = phase_extension(state, progress)
                pose = transform_pose(
                    base, side, extension, yaw, noise, rng, rep_index == incorrect_rep
                )
                lost = (
                    rep_index == tracking_loss_at
                    and state == "EXTENSION"
                    and state_frame in {max(0, count // 2 - 1), count // 2}
                )
                if lost:
                    for point in pose:
                        point[3] = 0.05
                compact = quantize(pose)
                frames.append({
                    "t": timestamp,
                    "p": compact,
                    "op": compact,
                    "wp": compact,
                    "a": {},
                    "me": 0.0,
                    "tc": 0.08 if lost else round(rng.uniform(0.82, 0.99), 4),
                    "observation": "synthetic",
                })
                timestamp += round(1000 / FPS)
            end = len(frames) - 1
            if rep_index == tracking_loss_at and state == "EXTENSION":
                lost_start = start + max(0, count // 2 - 1)
                lost_end = start + count // 2
                if lost_start > start:
                    segments.append({
                        "start_frame": start, "end_frame": lost_start - 1,
                        "state": state, "rep": rep_index + 1,
                    })
                segments.append({
                    "start_frame": lost_start, "end_frame": lost_end,
                    "state": "__TRACKING_LOST__", "rep": rep_index + 1,
                })
                if lost_end < end:
                    segments.append({
                        "start_frame": lost_end + 1, "end_frame": end,
                        "state": state, "rep": rep_index + 1,
                    })
            else:
                segments.append({
                    "start_frame": start,
                    "end_frame": end,
                    "state": state,
                    "rep": rep_index + 1,
                })
    enrich_physics(frames, side)
    return {
        "schema_version": "1.1",
        "session_id": f"synthetic-jab-{index:04d}-{uuid.uuid4().hex[:8]}",
        "source": "physics_synthetic_generator",
        "provenance": {
            "origin": "synthetic",
            "generator": "jab-v1",
            "seeded": True,
            "human_verified": False,
            "intended_use": "bootstrap_pretraining_only",
        },
        "technique_id": "jab",
        "technique_name": "Jab",
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
    if args.sessions < 4 or args.min_reps < 1 or args.max_reps < args.min_reps:
        raise ValueError("Use at least 4 sessions and a valid repetition range")
    rng = random.Random(args.seed)
    sessions = [
        generate_session(index + 1, rng, args.min_reps, args.max_reps)
        for index in range(args.sessions)
    ]
    document = {
        "schema_version": "1.1",
        "dataset_type": "physics_synthetic_bootstrap",
        "label_authority": "generator_state_machine",
        "technique_profile": args.technique_profile,
        "generated_at": datetime.now(UTC).isoformat(),
        "warning": "Synthetic bootstrap data; never use as production test evidence.",
        "sessions": sessions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(sessions)} synthetic Jab sessions to {args.output}")


if __name__ == "__main__":
    main()
