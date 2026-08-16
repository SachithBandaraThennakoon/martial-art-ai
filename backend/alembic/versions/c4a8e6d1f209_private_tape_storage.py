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
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    def _column_exists(table_name: str, column_name: str) -> bool:
        return column_name in {column["name"] for column in inspector.get_columns(table_name)}

    def _constraint_exists(constraint_name: str) -> bool:
        return any(item.get("name") == constraint_name for item in inspector.get_unique_constraints("practice_session_tapes"))

    def _index_exists(index_name: str) -> bool:
        return any(item.get("name") == index_name for item in inspector.get_indexes("practice_session_tapes"))

    with op.batch_alter_table("practice_session_tapes") as batch_op:
        batch_op.alter_column("payload", existing_type=sa.LargeBinary(), nullable=True)

    if not _column_exists("practice_session_tapes", "storage_provider"):
        op.add_column(
            "practice_session_tapes",
            sa.Column("storage_provider", sa.String(24), nullable=False, server_default="database"),
        )
    if not _column_exists("practice_session_tapes", "blob_name"):
        op.add_column("practice_session_tapes", sa.Column("blob_name", sa.String(512), nullable=True))
    if not _column_exists("practice_session_tapes", "upload_status"):
        op.add_column(
            "practice_session_tapes",
            sa.Column("upload_status", sa.String(24), nullable=False, server_default="ready"),
        )
    if not _column_exists("practice_session_tapes", "content_sha256"):
        op.add_column("practice_session_tapes", sa.Column("content_sha256", sa.String(64), nullable=True))
    if not _column_exists("practice_session_tapes", "idempotency_key"):
        op.add_column("practice_session_tapes", sa.Column("idempotency_key", sa.String(64), nullable=True))
    if not _column_exists("practice_session_tapes", "schema_name"):
        op.add_column(
            "practice_session_tapes",
            sa.Column("schema_name", sa.String(96), nullable=False, server_default="practice-tape/v2"),
        )
    if not _column_exists("practice_session_tapes", "capture_source"):
        op.add_column(
            "practice_session_tapes",
            sa.Column("capture_source", sa.String(32), nullable=False, server_default="device_estimate"),
        )
    if not _column_exists("practice_session_tapes", "algorithm_version"):
        op.add_column("practice_session_tapes", sa.Column("algorithm_version", sa.String(96), nullable=True))
    if not _column_exists("practice_session_tapes", "config_version"):
        op.add_column("practice_session_tapes", sa.Column("config_version", sa.String(96), nullable=True))
    if not _column_exists("practice_session_tapes", "verified_at"):
        op.add_column("practice_session_tapes", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    if not _column_exists("practice_session_tapes", "expires_at"):
        op.add_column("practice_session_tapes", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    if not _constraint_exists("uq_practice_tapes_blob_name"):
        with op.batch_alter_table("practice_session_tapes") as batch_op:
            batch_op.create_unique_constraint("uq_practice_tapes_blob_name", ["blob_name"])
    if not _index_exists("ix_practice_session_tapes_upload_status"):
        op.create_index("ix_practice_session_tapes_upload_status", "practice_session_tapes", ["upload_status"])
    if not _index_exists("ix_practice_session_tapes_content_sha256"):
        op.create_index("ix_practice_session_tapes_content_sha256", "practice_session_tapes", ["content_sha256"])
    if not _index_exists("ix_practice_session_tapes_expires_at"):
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
