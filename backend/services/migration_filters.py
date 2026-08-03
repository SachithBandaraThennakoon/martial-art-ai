"""Alembic comparison policy for retained, pre-baseline legacy objects."""

RETAINED_LEGACY_TABLES = {"martial_categories", "technique_groups"}
RETAINED_TECHNIQUE_COLUMNS = {"group_id", "image_url", "video_url", "is_premium"}


def include_schema_object(object_, name, type_, reflected, compare_to) -> bool:
    # These unused prototype taxonomy objects may contain user-authored data.
    # Keep them during baseline adoption; remove them only in a separately
    # reviewed data-retention migration.
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
            table_name = getattr(getattr(object_, "table", None), "name", None)
            column_names = {column.name for column in getattr(object_, "columns", [])}
            if table_name == "techniques" and column_names == {"group_id"}:
                return False
    return True
