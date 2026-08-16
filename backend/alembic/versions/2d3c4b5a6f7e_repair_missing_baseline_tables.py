"""Repair missing baseline tables.

Revision ID: 2d3c4b5a6f7e
Revises: f8c2d4a6b901
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2d3c4b5a6f7e"
down_revision: Union[str, Sequence[str], None] = "f8c2d4a6b901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(connection, table_name: str) -> bool:
    return sa.inspect(connection).has_table(table_name)


def _index_exists(connection, index_name: str) -> bool:
    inspector = sa.inspect(connection)
    return any(
        item.get("name") == index_name
        for table_name in ("rate_limit_buckets", "refresh_sessions")
        if inspector.has_table(table_name)
        for item in inspector.get_indexes(table_name)
    )


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "rate_limit_buckets"):
        op.create_table(
            "rate_limit_buckets",
            sa.Column("scope", sa.String(80), nullable=False),
            sa.Column("subject_hash", sa.String(64), nullable=False),
            sa.Column("window_start", sa.BigInteger(), nullable=False),
            sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("scope", "subject_hash", "window_start"),
        )
    if not _index_exists(conn, "ix_rate_limit_buckets_expires_at"):
        op.create_index(
            "ix_rate_limit_buckets_expires_at",
            "rate_limit_buckets",
            ["expires_at"],
            unique=False,
        )

    if not _table_exists(conn, "refresh_sessions"):
        op.create_table(
            "refresh_sessions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("family_id", sa.String(64), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("replaced_by_hash", sa.String(64), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("user_agent_hash", sa.String(64), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash", name="uq_refresh_sessions_token_hash"),
        )
    if not _index_exists(conn, "ix_refresh_sessions_user_id"):
        op.create_index(
            "ix_refresh_sessions_user_id",
            "refresh_sessions",
            ["user_id"],
            unique=False,
        )
    if not _index_exists(conn, "ix_refresh_sessions_family_id"):
        op.create_index(
            "ix_refresh_sessions_family_id",
            "refresh_sessions",
            ["family_id"],
            unique=False,
        )
    if not _index_exists(conn, "ix_refresh_sessions_expires_at"):
        op.create_index(
            "ix_refresh_sessions_expires_at",
            "refresh_sessions",
            ["expires_at"],
            unique=False,
        )
    if not _index_exists(conn, "ix_refresh_sessions_revoked_at"):
        op.create_index(
            "ix_refresh_sessions_revoked_at",
            "refresh_sessions",
            ["revoked_at"],
            unique=False,
        )


def downgrade() -> None:
    # These are baseline-owned tables. Leaving them in place allows the baseline
    # downgrade to remove them exactly once, including when this repair was a no-op.
    pass
