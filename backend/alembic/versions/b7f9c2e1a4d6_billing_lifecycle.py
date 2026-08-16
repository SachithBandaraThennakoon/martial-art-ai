"""Add durable billing lifecycle records and provider ownership constraints.

Revision ID: b7f9c2e1a4d6
Revises: 883102153f8d
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7f9c2e1a4d6"
down_revision: Union[str, Sequence[str], None] = "883102153f8d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    def _table_exists(table_name: str) -> bool:
        return inspector.has_table(table_name)

    def _constraint_exists(constraint_name: str) -> bool:
        return any(
            constraint.get("name") == constraint_name
            for constraint in inspector.get_unique_constraints("users")
        )

    if not _constraint_exists("uq_users_paypal_subscription_id"):
        with op.batch_alter_table("users") as batch_op:
            batch_op.create_unique_constraint(
                "uq_users_paypal_subscription_id",
                ["paypal_subscription_id"],
            )

    if not _table_exists("billing_subscriptions"):
        op.create_table(
            "billing_subscriptions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("provider", sa.String(length=24), nullable=False),
            sa.Column("provider_subscription_id", sa.String(length=128), nullable=False),
            sa.Column("provider_plan_id", sa.String(length=128), nullable=False),
            sa.Column("internal_plan", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("needs_review", sa.Boolean(), nullable=False),
            sa.Column("status_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_payment_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_failed_payment_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_reconciled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_billing_subscriptions_id", "billing_subscriptions", ["id"])
        op.create_index("ix_billing_subscriptions_user_id", "billing_subscriptions", ["user_id"])
        op.create_index(
            "ix_billing_subscriptions_provider_subscription_id",
            "billing_subscriptions",
            ["provider_subscription_id"],
            unique=True,
        )
        op.create_index("ix_billing_subscriptions_provider_plan_id", "billing_subscriptions", ["provider_plan_id"])
        op.create_index("ix_billing_subscriptions_status", "billing_subscriptions", ["status"])
        op.create_index("ix_billing_subscriptions_needs_review", "billing_subscriptions", ["needs_review"])
        op.create_index(
            "ix_billing_subscriptions_last_reconciled_at",
            "billing_subscriptions",
            ["last_reconciled_at"],
        )

    if not _table_exists("billing_events"):
        op.create_table(
            "billing_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("provider_event_id", sa.String(length=128), nullable=False),
            sa.Column("event_type", sa.String(length=96), nullable=False),
            sa.Column("provider_subscription_id", sa.String(length=128), nullable=True),
            sa.Column("provider_resource_id", sa.String(length=128), nullable=True),
            sa.Column("payload_hash", sa.String(length=64), nullable=False),
            sa.Column("verification_status", sa.String(length=24), nullable=False),
            sa.Column("processing_status", sa.String(length=24), nullable=False),
            sa.Column("error_code", sa.String(length=64), nullable=True),
            sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_billing_events_id", "billing_events", ["id"])
        op.create_index(
            "ix_billing_events_provider_event_id",
            "billing_events",
            ["provider_event_id"],
            unique=True,
        )
        op.create_index("ix_billing_events_event_type", "billing_events", ["event_type"])
        op.create_index(
            "ix_billing_events_provider_subscription_id",
            "billing_events",
            ["provider_subscription_id"],
        )
        op.create_index("ix_billing_events_processing_status", "billing_events", ["processing_status"])


def downgrade() -> None:
    op.drop_index("ix_billing_events_processing_status", table_name="billing_events")
    op.drop_index("ix_billing_events_provider_subscription_id", table_name="billing_events")
    op.drop_index("ix_billing_events_event_type", table_name="billing_events")
    op.drop_index("ix_billing_events_provider_event_id", table_name="billing_events")
    op.drop_index("ix_billing_events_id", table_name="billing_events")
    op.drop_table("billing_events")

    op.drop_index("ix_billing_subscriptions_last_reconciled_at", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_needs_review", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_status", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_provider_plan_id", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_provider_subscription_id", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_user_id", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_id", table_name="billing_subscriptions")
    op.drop_table("billing_subscriptions")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("uq_users_paypal_subscription_id", type_="unique")
