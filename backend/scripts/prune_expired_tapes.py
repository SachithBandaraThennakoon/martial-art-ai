"""Delete expired practice tapes and their database metadata."""
import logging
import os
import sys
from datetime import datetime, timezone

from database import SessionLocal, check_database_ready
from models.training_memory import PracticeSessionTape
from services.tape_storage import delete_tape_blob


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> int:
    if not check_database_ready():
        logger.error("Database is unavailable or not upgraded to the Alembic head")
        return 2
    batch_size = max(1, min(int(os.getenv("TAPE_PRUNE_BATCH_SIZE", "200")), 1000))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    failed = 0
    deleted = 0
    with SessionLocal() as db:
        tapes = (
            db.query(PracticeSessionTape)
            .filter(PracticeSessionTape.expires_at.is_not(None), PracticeSessionTape.expires_at <= now)
            .order_by(PracticeSessionTape.expires_at, PracticeSessionTape.id)
            .limit(batch_size)
            .all()
        )
        for tape in tapes:
            try:
                if tape.storage_provider == "azure" and tape.blob_name:
                    delete_tape_blob(tape.blob_name)
                db.delete(tape)
                db.commit()
                deleted += 1
            except Exception as exc:
                db.rollback()
                failed += 1
                logger.error("Could not prune tape %s: %s", tape.id, exc)
    logger.info("Pruned %s expired tape(s); %s failed", deleted, failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
