from fastapi import HTTPException
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Add it to backend/.env.")

# Supabase's session pooler already owns connection health.  A client-side
# pre-ping makes every request perform an additional remote round trip, which
# is especially noticeable for the public catalog.  Keep it for direct/local
# databases, but let the pooler reuse its healthy sessions without that cost.
is_supabase_pooler = "pooler.supabase.com" in DATABASE_URL.lower()
engine = create_engine(DATABASE_URL, pool_pre_ping=not is_supabase_pooler)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def database_readiness() -> dict:
    started = time.perf_counter()
    try:
        alembic_config = Config(os.path.join(os.path.dirname(__file__), "alembic.ini"))
        expected_heads = set(ScriptDirectory.from_config(alembic_config).get_heads())
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            current_heads = set(MigrationContext.configure(connection).get_current_heads())
        if current_heads != expected_heads:
            return {
                "ready": False,
                "database": "reachable",
                "migrations": "mismatch",
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        return {
            "ready": True,
            "database": "reachable",
            "migrations": "current",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except SQLAlchemyError:
        return {
            "ready": False,
            "database": "unavailable",
            "migrations": "unknown",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except (CommandError, OSError, RuntimeError, ValueError):
        return {
            "ready": False,
            "database": "unknown",
            "migrations": "unavailable",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }


def check_database_ready():
    status = database_readiness()
    if not status["ready"]:
        logger.error(
            "Database readiness failed",
            extra={"event": "database_not_ready", "component": "database", "outcome": status["migrations"]},
        )
    return bool(status["ready"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Start PostgreSQL and check DATABASE_URL."
        ) from exc
    finally:
        db.close()
