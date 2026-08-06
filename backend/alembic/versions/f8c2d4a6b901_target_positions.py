"""Store normalized target positions for technique steps.

Revision ID: f8c2d4a6b901
Revises: e5b7f4a2c631
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8c2d4a6b901"
down_revision: Union[str, Sequence[str], None] = "e5b7f4a2c631"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    def _table_exists(table_name: str) -> bool:
        return conn.execute(
            sa.text("SELECT to_regclass(:table_name)"),
            {"table_name": table_name},
        ).scalar() is not None

    def _index_exists(index_name: str) -> bool:
        return conn.execute(
            sa.text(
                "SELECT 1 FROM pg_indexes WHERE indexname = :index_name"
            ),
            {"index_name": index_name},
        ).fetchone() is not None

    if not _table_exists("target_positions"):
        op.create_table(
            "target_positions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("step_id", sa.Integer(), nullable=False),
            sa.Column("body_part", sa.String(), nullable=False),
            sa.Column("x", sa.Float(), nullable=False),
            sa.Column("y", sa.Float(), nullable=False),
            sa.Column("z", sa.Float(), nullable=False),
            sa.Column("tolerance", sa.Float(), nullable=False),
            sa.Column("coordinate_space", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["step_id"], ["technique_steps.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("step_id", "body_part", name="uq_target_position_step_body_part"),
        )
    if not _index_exists("ix_target_positions_step_id"):
        op.create_index("ix_target_positions_step_id", "target_positions", ["step_id"])


def downgrade() -> None:
    op.drop_index("ix_target_positions_step_id", table_name="target_positions")
    op.drop_table("target_positions")
