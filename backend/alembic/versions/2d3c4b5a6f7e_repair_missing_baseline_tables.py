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
    return connection.execute(
        sa.text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    ).scalar() is not None


def _index_exists(connection, index_name: str) -> bool:
    return connection.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :index_name"),
        {"index_name": index_name},
    ).fetchone() is not None


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
    if op.get_bind().execute(sa.text("SELECT to_regclass(:table_name)"), {"table_name": "public.refresh_sessions"}).scalar() is not None:
        op.drop_index("ix_refresh_sessions_revoked_at", table_name="refresh_sessions")
        op.drop_index("ix_refresh_sessions_expires_at", table_name="refresh_sessions")
        op.drop_index("ix_refresh_sessions_family_id", table_name="refresh_sessions")
        op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
        op.drop_table("refresh_sessions")
    if op.get_bind().execute(sa.text("SELECT to_regclass(:table_name)"), {"table_name": "public.rate_limit_buckets"}).scalar() is not None:
        op.drop_index("ix_rate_limit_buckets_expires_at", table_name="rate_limit_buckets")
        op.drop_table("rate_limit_buckets")
