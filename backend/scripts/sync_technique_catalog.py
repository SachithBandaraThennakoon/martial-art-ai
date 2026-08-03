"""Explicitly synchronize reviewed technique packages into the database."""
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from database import SessionLocal, check_database_ready  # noqa: E402
from services.catalog_sync import sync_technique_catalog  # noqa: E402


def main() -> None:
    if not check_database_ready():
        raise SystemExit("Database must be upgraded to the Alembic head before catalog sync")
    with SessionLocal() as database:
        result = sync_technique_catalog(database)
    print(
        "Technique catalog synchronized: "
        f"{result['created']} created, {result['updated']} updated, {result['total']} total."
    )


if __name__ == "__main__":
    main()
