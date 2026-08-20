"""Read-only navigation API backed by the checked-in system catalog snapshot."""

from fastapi import APIRouter, HTTPException

from services.cache import CATALOG_TREE_CACHE_KEY, get_json, set_json
from services.system_snapshots import load_catalog_snapshot


router = APIRouter(prefix="/catalog", tags=["Catalog"])
_CATALOG_CACHE_SECONDS = 5 * 60


def _catalog_payload() -> dict:
    cached_payload = get_json(CATALOG_TREE_CACHE_KEY)
    if cached_payload is not None:
        return cached_payload

    snapshot_payload = load_catalog_snapshot()
    if snapshot_payload is None:
        raise HTTPException(503, "System catalog snapshot is unavailable")
    set_json(CATALOG_TREE_CACHE_KEY, snapshot_payload, _CATALOG_CACHE_SECONDS)
    return snapshot_payload


@router.get("")
def get_catalog():
    """Return the static system catalog without a cloud database query."""
    return _catalog_payload()


def _find_node(nodes: list[dict], slug: str) -> dict | None:
    for node in nodes:
        if node.get("slug") == slug:
            return node
        found = _find_node(node.get("children") or [], slug)
        if found is not None:
            return found
    return None


@router.get("/{node_slug}")
def get_catalog_node(node_slug: str):
    node = _find_node(_catalog_payload().get("nodes") or [], node_slug)
    if node is None:
        raise HTTPException(404, "Catalog node not found")
    return node
