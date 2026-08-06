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

    if not _table_exists("consent_records"):
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
    if not _index_exists("ix_consent_records_id"):
        op.create_index("ix_consent_records_id", "consent_records", ["id"])
    if not _index_exists("ix_consent_records_user_id"):
        op.create_index("ix_consent_records_user_id", "consent_records", ["user_id"])
    if not _index_exists("ix_consent_records_document_type"):
        op.create_index("ix_consent_records_document_type", "consent_records", ["document_type"])


def downgrade() -> None:
    op.drop_index("ix_consent_records_document_type", table_name="consent_records")
    op.drop_index("ix_consent_records_user_id", table_name="consent_records")
    op.drop_index("ix_consent_records_id", table_name="consent_records")
    op.drop_table("consent_records")
