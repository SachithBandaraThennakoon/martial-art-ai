"""Add awareness knowledge governance and decision evaluations.

Revision ID: b4e2f8a6d713
Revises: a9d1e7f3c502
Create Date: 2026-08-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4e2f8a6d713"
down_revision: Union[str, Sequence[str], None] = "a9d1e7f3c502"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "awareness_knowledge_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.String(96), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", "version", name="uq_awareness_knowledge_profile_version"),
    )
    op.create_index("ix_awareness_knowledge_profiles_id", "awareness_knowledge_profiles", ["id"])
    op.create_index("ix_awareness_knowledge_profiles_profile_id", "awareness_knowledge_profiles", ["profile_id"])
    op.create_index("ix_awareness_knowledge_profiles_status", "awareness_knowledge_profiles", ["status"])
    op.create_index("ix_awareness_knowledge_profiles_created_by_user_id", "awareness_knowledge_profiles", ["created_by_user_id"])
    op.create_table(
        "awareness_decision_evaluations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("awareness_session_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("client_state", sa.String(64), nullable=True),
        sa.Column("backend_state", sa.String(64), nullable=True),
        sa.Column("client_command", sa.String(96), nullable=True),
        sa.Column("backend_command", sa.String(96), nullable=True),
        sa.Column("state_agreement", sa.Boolean(), nullable=True),
        sa.Column("command_agreement", sa.Boolean(), nullable=True),
        sa.Column("backend_confidence", sa.Float(), nullable=True),
        sa.Column("knowledge_profile_id", sa.String(96), nullable=False),
        sa.Column("knowledge_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["awareness_session_id"], ["awareness_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("awareness_session_id", "revision", name="uq_awareness_evaluation_session_revision"),
    )
    op.create_index("ix_awareness_decision_evaluations_id", "awareness_decision_evaluations", ["id"])
    op.create_index("ix_awareness_decision_evaluations_awareness_session_id", "awareness_decision_evaluations", ["awareness_session_id"])


def downgrade() -> None:
    op.drop_table("awareness_decision_evaluations")
    op.drop_table("awareness_knowledge_profiles")
