from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, func

from database import Base


class BillingSubscription(Base):
    __tablename__ = "billing_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(24), nullable=False, default="paypal")
    provider_subscription_id = Column(String(128), nullable=False, unique=True, index=True)
    provider_plan_id = Column(String(128), nullable=False, index=True)
    internal_plan = Column(String(32), nullable=False)
    status = Column(String(32), nullable=False, index=True)
    needs_review = Column(Boolean, nullable=False, default=False, index=True)
    status_updated_at = Column(DateTime(timezone=True), nullable=True)
    last_payment_at = Column(DateTime(timezone=True), nullable=True)
    last_failed_payment_at = Column(DateTime(timezone=True), nullable=True)
    last_reconciled_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class BillingEvent(Base):
    __tablename__ = "billing_events"

    id = Column(Integer, primary_key=True, index=True)
    provider_event_id = Column(String(128), nullable=False, unique=True, index=True)
    event_type = Column(String(96), nullable=False, index=True)
    provider_subscription_id = Column(String(128), nullable=True, index=True)
    provider_resource_id = Column(String(128), nullable=True)
    payload_hash = Column(String(64), nullable=False)
    verification_status = Column(String(24), nullable=False)
    processing_status = Column(String(24), nullable=False, index=True)
    error_code = Column(String(64), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)
