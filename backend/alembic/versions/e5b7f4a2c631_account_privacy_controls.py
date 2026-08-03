"""Add versioned account consent records.

Revision ID: e5b7f4a2c631
Revises: c4a8e6d1f209
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5b7f4a2c631"
down_revision: Union[str, Sequence[str], None] = "c4a8e6d1f209"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "consent_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("document_version", sa.String(32), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "document_type", "document_version", name="uq_consent_user_document_version"),
    )
    op.create_index("ix_consent_records_id", "consent_records", ["id"])
    op.create_index("ix_consent_records_user_id", "consent_records", ["user_id"])
    op.create_index("ix_consent_records_document_type", "consent_records", ["document_type"])


def downgrade() -> None:
    op.drop_index("ix_consent_records_document_type", table_name="consent_records")
    op.drop_index("ix_consent_records_user_id", table_name="consent_records")
    op.drop_index("ix_consent_records_id", table_name="consent_records")
    op.drop_table("consent_records")
