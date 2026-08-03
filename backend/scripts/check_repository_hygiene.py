"""Fail CI when local secrets or generated runtime artifacts are tracked."""

from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN_PARTS = {"__pycache__", "venv", ".venv", "node_modules"}
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(rb"\bghp_[A-Za-z0-9]{36}\b"),
)


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in result.stdout.split(b"\0") if item]


def violations_for(path_text: str) -> list[str]:
    path = PurePosixPath(path_text)
    issues: list[str] = []
    if path.name == ".env":
        issues.append("local .env file is tracked")
    if path.suffix.lower() in {".pyc", ".pyo"}:
        issues.append("compiled Python artifact is tracked")
    if FORBIDDEN_PARTS.intersection(path.parts):
        issues.append("generated dependency/cache directory is tracked")

    local_path = REPOSITORY_ROOT / Path(*path.parts)
    if local_path.is_file() and local_path.stat().st_size <= 2_000_000:
        content = local_path.read_bytes()
        for pattern in SECRET_PATTERNS:
            if pattern.search(content):
                issues.append("high-confidence credential pattern is tracked")
                break
    return issues


def main() -> int:
    violations = [
        f"{path}: {issue}"
        for path in tracked_files()
        for issue in violations_for(path)
    ]
    if violations:
        print("Repository hygiene check failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    print("Repository hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
