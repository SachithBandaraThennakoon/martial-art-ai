import os
from pathlib import Path
import unittest
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from database import Base
from models import (  # noqa: F401
    billing,
    body_calibration,
    contact_message,
    password_reset_token,
    privacy,
    rate_limit_bucket,
    refresh_session,
    target_angle,
    technique,
    technique_step,
    training_memory,
    user,
)
from scripts.adopt_existing_database import (
    BASELINE_REVISION,
    adopt_database,
    baseline_metadata,
    validate_database,
)


BACKEND_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_TABLES = set(Base.metadata.tables)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.database_path = BACKEND_ROOT / f".migration-test-{uuid4().hex}.db"
        self.database_url = f"sqlite:///{self.database_path.as_posix()}"
        self.previous_database_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = self.database_url
        self.config = Config(str(BACKEND_ROOT / "alembic.ini"))

    def tearDown(self):
        if self.previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = self.previous_database_url
        if self.database_path.exists():
            self.database_path.unlink()

    def test_fresh_upgrade_matches_model_metadata_and_downgrades(self):
        command.upgrade(self.config, "head")
        engine = create_engine(self.database_url)
        try:
            tables = set(inspect(engine).get_table_names())
            self.assertEqual(tables, EXPECTED_TABLES | {"alembic_version"})
            with engine.connect() as connection:
                self.assertTrue(MigrationContext.configure(connection).get_current_revision())
        finally:
            engine.dispose()

        command.check(self.config)
        command.downgrade(self.config, "base")
        engine = create_engine(self.database_url)
        try:
            self.assertEqual(set(inspect(engine).get_table_names()), {"alembic_version"})
        finally:
            engine.dispose()

    def test_matching_legacy_schema_can_be_validated_and_adopted(self):
        engine = create_engine(self.database_url)
        baseline_metadata().create_all(engine)
        engine.dispose()

        validate_database(self.database_url)
        adopt_database(self.database_url, confirm=True)

        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                self.assertEqual(
                    MigrationContext.configure(connection).get_current_revision(),
                    BASELINE_REVISION,
                )
        finally:
            engine.dispose()

        command.upgrade(self.config, "head")
        command.check(self.config)

    def test_incomplete_schema_is_never_stamped(self):
        engine = create_engine(self.database_url)
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        engine.dispose()

        with self.assertRaisesRegex(RuntimeError, "does not match"):
            adopt_database(self.database_url, confirm=True)

        engine = create_engine(self.database_url)
        try:
            self.assertNotIn("alembic_version", inspect(engine).get_table_names())
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
