"""Move static catalog navigation from PostgreSQL to backend JSON.

Revision ID: b45e92c1d713
Revises: a13d84f6b921
"""
from typing import Sequence, Union

from alembic import op


revision: str = "b45e92c1d713"
down_revision: Union[str, Sequence[str], None] = "a13d84f6b921"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("catalog_placements")
    op.drop_table("catalog_items")
    op.drop_table("catalog_nodes")


def downgrade() -> None:
    raise NotImplementedError(
        "Catalog navigation is maintained in backend JSON; restore from a database backup if required."
    )
