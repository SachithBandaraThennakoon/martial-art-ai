"""Remove superseded prototype taxonomy tables and technique columns.

Revision ID: fc06b8d0e145
Revises: fbf5a7c9d034
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "fc06b8d0e145"
down_revision: Union[str, Sequence[str], None] = "fbf5a7c9d034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Superseded by catalog_nodes/catalog_items and required_plan.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    technique_columns = {
        column["name"] for column in inspector.get_columns("techniques")
    }
    legacy_columns = [
        name for name in ("group_id", "image_url", "video_url", "is_premium")
        if name in technique_columns
    ]
    if legacy_columns:
        with op.batch_alter_table("techniques") as batch_op:
            for column_name in legacy_columns:
                batch_op.drop_column(column_name)
    existing_tables = set(inspector.get_table_names())
    for table_name in ("technique_groups", "martial_categories"):
        if table_name in existing_tables:
            op.drop_table(table_name)


def downgrade() -> None:
    # These prototype objects were optional and are absent from the canonical
    # baseline. A downgrade must not invent schema that was never present.
    pass
