"""Alembic comparison policy for retained, pre-baseline legacy objects."""

RETAINED_LEGACY_TABLES = {"practice_session_annotations", "user_bio"}
RETAINED_TECHNIQUE_COLUMNS = set()


def include_schema_object(object_, name, type_, reflected, compare_to) -> bool:
    # These unused prototype taxonomy objects may contain user-authored data.
    # Keep them during baseline adoption; remove them only in a separately
    # reviewed data-retention migration.
    table_name = getattr(getattr(object_, "table", None), "name", None)
    if type_ in {"index", "unique_constraint", "foreign_key_constraint", "column"} and table_name in RETAINED_LEGACY_TABLES:
        return False
    if reflected and compare_to is None:
        if type_ == "table" and name in RETAINED_LEGACY_TABLES:
            return False
        if (
            type_ == "column"
            and getattr(getattr(object_, "table", None), "name", None) == "techniques"
            and name in RETAINED_TECHNIQUE_COLUMNS
        ):
            return False
        if type_ == "foreign_key_constraint":
            column_names = {column.name for column in getattr(object_, "columns", [])}
            if table_name == "techniques" and column_names == {"group_id"}:
                return False
        # Repair migrations intentionally retained these database-native unique
        # constraints. They are equivalent to the model's uniqueness/index
        # declarations and must not create destructive autogenerate churn.
        if type_ == "unique_constraint" and table_name in {"awareness_events", "refresh_sessions"}:
            return False
    if not reflected and compare_to is None and type_ == "index" and table_name == "refresh_sessions":
        if name in {"ix_refresh_sessions_id", "ix_refresh_sessions_token_hash"}:
            return False
    return True
