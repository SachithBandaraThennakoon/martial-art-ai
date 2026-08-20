"""Small JSON cache with Redis support and an in-process development fallback.

PostgreSQL remains authoritative.  This module only caches read responses and
never stores a second editable copy of platform data.
"""

from __future__ import annotations

import json
import logging
import os
from threading import Lock
from time import monotonic
from typing import Any


logger = logging.getLogger(__name__)

_memory_cache: dict[str, tuple[float, Any]] = {}
_memory_lock = Lock()
_redis_client = None
_redis_checked = False

CATALOG_TREE_CACHE_KEY = "xma:catalog:tree:v1"


def _get_redis_client():
    """Return a configured Redis client, without making Redis mandatory locally."""
    global _redis_checked, _redis_client
    if _redis_checked:
        return _redis_client

    _redis_checked = True
    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        return None
    try:
        import redis

        client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=1,
        )
        client.ping()
        _redis_client = client
        logger.info("Shared Redis cache enabled")
    except Exception:
        logger.warning("Redis cache is unavailable; using in-process cache", exc_info=True)
    return _redis_client


def get_json(key: str) -> Any | None:
    client = _get_redis_client()
    if client is not None:
        try:
            value = client.get(key)
            return json.loads(value) if value else None
        except Exception:
            logger.warning("Redis cache read failed", exc_info=True)

    now = monotonic()
    with _memory_lock:
        entry = _memory_cache.get(key)
        if entry is None or entry[0] <= now:
            _memory_cache.pop(key, None)
            return None
        return entry[1]


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, json.dumps(value, separators=(",", ":")))
            return
        except Exception:
            logger.warning("Redis cache write failed", exc_info=True)

    with _memory_lock:
        _memory_cache[key] = (monotonic() + ttl_seconds, value)


def delete(key: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception:
            logger.warning("Redis cache delete failed", exc_info=True)
    with _memory_lock:
        _memory_cache.pop(key, None)


def invalidate_catalog_cache() -> None:
    """Invalidate read-only catalog data after a successful catalog write.

    Write routes and controlled one-off catalog repairs use this shared hook so
    they follow the same invalidation path as normal admin changes.
    """
    delete(CATALOG_TREE_CACHE_KEY)
