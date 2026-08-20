"""Remove normalized technique target tables superseded by training_config JSONB.

Revision ID: fd17c9e2a463
Revises: fc06b8d0e145
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "fd17c9e2a463"
down_revision: Union[str, Sequence[str], None] = "fc06b8d0e145"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("target_positions")
    op.drop_table("target_angles")
    op.drop_table("technique_steps")


def downgrade() -> None:
    op.create_table(
        "technique_steps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technique_id", sa.Integer(), sa.ForeignKey("techniques.id"), nullable=True),
        sa.Column("step_number", sa.Integer(), nullable=True),
        sa.Column("step_name", sa.String(), nullable=True),
    )
    op.create_table(
        "target_angles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("step_id", sa.Integer(), sa.ForeignKey("technique_steps.id"), nullable=True),
        sa.Column("body_part", sa.String(), nullable=True),
        sa.Column("min_angle", sa.Float(), nullable=True),
        sa.Column("max_angle", sa.Float(), nullable=True),
    )
    op.create_table(
        "target_positions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("step_id", sa.Integer(), sa.ForeignKey("technique_steps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body_part", sa.String(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("z", sa.Float(), nullable=False),
        sa.Column("tolerance", sa.Float(), nullable=False),
        sa.Column("coordinate_space", sa.String(), nullable=False),
        sa.UniqueConstraint("step_id", "body_part", name="uq_target_position_step_body_part"),
    )
    op.create_index("ix_target_positions_step_id", "target_positions", ["step_id"])
