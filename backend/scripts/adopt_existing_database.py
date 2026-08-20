"""Validate and stamp a pre-Alembic database without modifying its schema."""
import argparse
import os
from pathlib import Path
import sys

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, MetaData, UniqueConstraint

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from database import Base  # noqa: E402
from models import (  # noqa: E402,F401
    awareness,
    billing,
    body_calibration,
    catalog,
    contact_message,
    password_reset_token,
    privacy,
    rate_limit_bucket,
    refresh_session,
    technique,
    training_memory,
    user,
)
from services.migration_filters import include_schema_object  # noqa: E402

BASELINE_REVISION = "883102153f8d"


def baseline_metadata() -> MetaData:
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name not in {
            "catalog_items", "catalog_nodes", "catalog_placements",
            "technique_revisions",
            "billing_events", "billing_subscriptions", "consent_records",
            "awareness_sessions", "awareness_events", "awareness_knowledge_profiles",
            "awareness_decision_evaluations", "awareness_object_memories",
            "awareness_relationship_memories",
            "awareness_action_deliveries",
        }:
            table.to_metadata(metadata)
    users_table = metadata.tables["users"]
    for constraint in list(users_table.constraints):
        if (
            isinstance(constraint, UniqueConstraint)
            and {column.name for column in constraint.columns}
            == {"paypal_subscription_id"}
        ):
            users_table.constraints.remove(constraint)
    tapes_table = metadata.tables["practice_session_tapes"]
    post_baseline_columns = {
        "storage_provider", "blob_name", "upload_status", "content_sha256",
        "idempotency_key", "schema_name", "capture_source", "algorithm_version",
        "config_version", "verified_at", "expires_at",
    }
    for index in list(tapes_table.indexes):
        if any(column.name in post_baseline_columns for column in index.columns):
            tapes_table.indexes.remove(index)
    for constraint in list(tapes_table.constraints):
        if any(column.name in post_baseline_columns for column in constraint.columns):
            tapes_table.constraints.remove(constraint)
    for column_name in post_baseline_columns:
        tapes_table._columns.remove(tapes_table.c[column_name])
    tapes_table.c.payload.nullable = False
    techniques_table = metadata.tables["techniques"]
    catalog_columns = {
        "slug", "status", "version", "training_config",
        "learning_content", "biomechanics_config", "optimization_config",
        "visualization_config", "metadata_json", "created_at", "updated_at",
    }
    for index in list(techniques_table.indexes):
        if any(column.name in catalog_columns for column in index.columns):
            techniques_table.indexes.remove(index)
    for column_name in catalog_columns:
        techniques_table._columns.remove(techniques_table.c[column_name])
    return metadata


def schema_differences(connection) -> list:
    expected_metadata = baseline_metadata()
    context = MigrationContext.configure(
        connection,
        opts={
            "compare_type": True,
            "target_metadata": expected_metadata,
            "include_object": include_schema_object,
        },
    )
    return compare_metadata(context, expected_metadata)


def validate_database(database_url: str) -> None:
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            if inspector.has_table("alembic_version"):
                raise RuntimeError(
                    "This database is already Alembic-managed; run 'alembic upgrade head'"
                )
            differences = schema_differences(connection)
            if differences:
                summary = "\n".join(f"- {difference[0]}" for difference in differences[:20])
                raise RuntimeError(
                    "Existing schema does not match the baseline and was not stamped:\n"
                    f"{summary}\nApply reviewed schema corrections before adoption."
                )
    finally:
        engine.dispose()


def adopt_database(database_url: str, confirm: bool = False) -> None:
    validate_database(database_url)
    if not confirm:
        raise RuntimeError("Schema matches; rerun with --confirm to stamp the database")

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        command.stamp(config, BASELINE_REVISION)
    finally:
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate and stamp an existing pre-Alembic database."
    )
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    try:
        if args.confirm:
            adopt_database(database_url, confirm=True)
            print(
                f"Existing schema validated and stamped at baseline {BASELINE_REVISION}. "
                "Run 'python -m alembic upgrade head' next."
            )
        else:
            validate_database(database_url)
            print("Schema matches the baseline. Rerun with --confirm to stamp it.")
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
