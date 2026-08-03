"""Reconcile locally linked PayPal subscriptions with provider state.

Run from the backend directory, for example every six hours:
    python -m scripts.reconcile_paypal_subscriptions
"""
import asyncio
import logging
import os
import sys

import httpx

from database import SessionLocal, check_database_ready
from models.billing import BillingSubscription
from models.user import User
from services.billing import apply_provider_subscription
from services.paypal_client import PayPalAPIError, get_access_token, get_subscription


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def reconcile() -> tuple[int, int]:
    batch_size = max(1, min(int(os.getenv("PAYPAL_RECONCILE_BATCH_SIZE", "200")), 1000))
    updated = 0
    failed = 0
    async with httpx.AsyncClient(timeout=12.0) as client:
        token = await get_access_token(client)
        with SessionLocal() as db:
            records = (
                db.query(BillingSubscription)
                .order_by(
                    BillingSubscription.last_reconciled_at.asc().nullsfirst(),
                    BillingSubscription.id,
                )
                .limit(batch_size)
                .all()
            )
            for record in records:
                user = db.query(User).filter(User.id == record.user_id).first()
                if not user:
                    record.needs_review = True
                    db.commit()
                    failed += 1
                    continue
                try:
                    details = await get_subscription(
                        record.provider_subscription_id,
                        client=client,
                        access_token=token,
                    )
                    apply_provider_subscription(db, record, user, details)
                    db.commit()
                    updated += 1
                except PayPalAPIError as exc:
                    db.rollback()
                    logger.error(
                        "Could not reconcile %s: %s",
                        record.provider_subscription_id,
                        exc,
                    )
                    failed += 1
    return updated, failed


def main() -> int:
    if not check_database_ready():
        logger.error("Database is unavailable or not upgraded to the Alembic head")
        return 2
    try:
        updated, failed = asyncio.run(reconcile())
    except (PayPalAPIError, ValueError) as exc:
        logger.error("Reconciliation could not start: %s", exc)
        return 2
    logger.info("Reconciled %s subscription(s); %s failed", updated, failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
