# Database migrations

Alembic owns the application schema. The API no longer creates or alters tables
during import or startup.

## Fresh database

Set `DATABASE_URL`, then run:

```powershell
python -m alembic upgrade head
python -m alembic check
```

Run migrations as a single release/deployment step before starting or scaling
the API. `RUN_DB_MIGRATIONS=true` can be used for a single-instance development
deployment, but should remain `false` for horizontally scaled production.

After the schema is current, synchronize reviewed technique packages once with:

```powershell
python -m scripts.sync_technique_catalog
```

`RUN_CATALOG_SYNC=true` is available for a single-instance development startup.
Keep it disabled on scaled production workers and run the command once in the
release workflow instead.

## Adopt a pre-Alembic database

Take and verify a backup first. The validation command is read-only:

```powershell
python -m scripts.adopt_existing_database
```

It compares tables, columns, indexes, foreign keys, uniqueness, and types against
the frozen baseline. It refuses to stamp an incomplete or incompatible schema.
If validation succeeds, explicitly adopt it:

```powershell
python -m scripts.adopt_existing_database --confirm
python -m alembic upgrade head
python -m alembic current
python -m alembic check
```

The unused legacy `martial_categories`, `technique_groups`, and associated
`techniques` columns are deliberately retained to avoid deleting historical
data. Remove them only through a separately reviewed retention migration.

## Create a schema change

1. Change the SQLAlchemy model.
2. Generate a revision with `python -m alembic revision --autogenerate -m "..."`.
3. Review every generated operation and add data backfills where necessary.
4. Test upgrade from the previous revision, `alembic check`, and downgrade on a
   disposable database.
5. Back up production and run `python -m alembic upgrade head` once in the
   deployment workflow before starting the new application version.

Never use `Base.metadata.create_all()` or ad-hoc startup `ALTER TABLE` operations
for application schema changes.
