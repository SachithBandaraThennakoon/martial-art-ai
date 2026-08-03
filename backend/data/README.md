# Legacy SQL migrations

The standalone SQL files in this directory predate Alembic and are retained only
as migration history. Do not apply them to new installations. The authoritative
schema history now begins at `alembic/versions/883102153f8d_baseline_schema.py`.

Existing databases must use the validation and adoption workflow documented in
`backend/MIGRATIONS.md`; fresh databases must run `python -m alembic upgrade head`.
