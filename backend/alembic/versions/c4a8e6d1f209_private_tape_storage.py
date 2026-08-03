"""Add private object-storage metadata and tape provenance.

Revision ID: c4a8e6d1f209
Revises: b7f9c2e1a4d6
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4a8e6d1f209"
down_revision: Union[str, Sequence[str], None] = "b7f9c2e1a4d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("practice_session_tapes") as batch_op:
        batch_op.alter_column("payload", existing_type=sa.LargeBinary(), nullable=True)

    op.add_column(
        "practice_session_tapes",
        sa.Column("storage_provider", sa.String(24), nullable=False, server_default="database"),
    )
    op.add_column("practice_session_tapes", sa.Column("blob_name", sa.String(512), nullable=True))
    op.add_column(
        "practice_session_tapes",
        sa.Column("upload_status", sa.String(24), nullable=False, server_default="ready"),
    )
    op.add_column("practice_session_tapes", sa.Column("content_sha256", sa.String(64), nullable=True))
    op.add_column("practice_session_tapes", sa.Column("idempotency_key", sa.String(64), nullable=True))
    op.add_column(
        "practice_session_tapes",
        sa.Column("schema_name", sa.String(96), nullable=False, server_default="practice-tape/v2"),
    )
    op.add_column(
        "practice_session_tapes",
        sa.Column("capture_source", sa.String(32), nullable=False, server_default="device_estimate"),
    )
    op.add_column("practice_session_tapes", sa.Column("algorithm_version", sa.String(96), nullable=True))
    op.add_column("practice_session_tapes", sa.Column("config_version", sa.String(96), nullable=True))
    op.add_column("practice_session_tapes", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("practice_session_tapes", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table("practice_session_tapes") as batch_op:
        batch_op.create_unique_constraint("uq_practice_tapes_blob_name", ["blob_name"])
    op.create_index("ix_practice_session_tapes_upload_status", "practice_session_tapes", ["upload_status"])
    op.create_index("ix_practice_session_tapes_content_sha256", "practice_session_tapes", ["content_sha256"])
    op.create_index("ix_practice_session_tapes_expires_at", "practice_session_tapes", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_practice_session_tapes_expires_at", table_name="practice_session_tapes")
    op.drop_index("ix_practice_session_tapes_content_sha256", table_name="practice_session_tapes")
    op.drop_index("ix_practice_session_tapes_upload_status", table_name="practice_session_tapes")
    with op.batch_alter_table("practice_session_tapes") as batch_op:
        batch_op.drop_constraint("uq_practice_tapes_blob_name", type_="unique")
    for column in (
        "expires_at", "verified_at", "config_version", "algorithm_version",
        "capture_source", "schema_name", "idempotency_key", "content_sha256",
        "upload_status", "blob_name", "storage_provider",
    ):
        op.drop_column("practice_session_tapes", column)
    with op.batch_alter_table("practice_session_tapes") as batch_op:
        batch_op.alter_column("payload", existing_type=sa.LargeBinary(), nullable=False)
