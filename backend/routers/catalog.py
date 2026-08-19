"""Read-only navigation API for the database-backed training catalog."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import re

from database import get_db
from models.catalog import CatalogItem, CatalogNode, CatalogPlacement


router = APIRouter(prefix="/catalog", tags=["Catalog"])


def _node_payload(node: CatalogNode) -> dict:
    return {
        "id": node.id,
        "slug": node.slug,
        "name": node.name,
        "node_type": node.node_type,
        "description": node.description,
        "sort_order": node.sort_order,
        "metadata": node.metadata_json,
    }


def _item_payload(item: CatalogItem) -> dict:
    return {
        "id": item.id,
        "slug": item.slug,
        "title": item.title,
        "resource_type": item.resource_type,
        "resource_id": item.resource_id,
        "metadata": item.metadata_json,
    }


@router.get("")
def get_catalog(db: Session = Depends(get_db)):
    """Return the complete active catalog tree from relational navigation data."""
    nodes = db.query(CatalogNode).filter(CatalogNode.active.is_(True)).order_by(
        CatalogNode.sort_order, CatalogNode.name
    ).all()
    placements = db.query(CatalogPlacement, CatalogItem).join(
        CatalogItem, CatalogItem.id == CatalogPlacement.catalog_item_id
    ).filter(CatalogItem.active.is_(True)).order_by(
        CatalogPlacement.sort_order, CatalogItem.title
    ).all()
    items_by_node = {}
    for placement, item in placements:
        payload = _item_payload(item)
        payload["is_primary"] = placement.is_primary
        payload["sort_order"] = placement.sort_order
        items_by_node.setdefault(placement.catalog_node_id, []).append(payload)

    def build_tree(node):
        children = [
            child for child in nodes
            if child.parent_id == node.id
            and (child.metadata_json or {}).get("resource_kind") == "catalog_node"
        ]
        # The legacy sync created duplicate top-level groups. The imported
        # taxonomy is the numbered hierarchy and is the single public tree.
        if node.parent_id is None:
            children = [child for child in children if re.match(r"^[1-8]\.\s", child.name or "")]
        return {
            **_node_payload(node),
            "children": [build_tree(child) for child in children],
            "items": items_by_node.get(node.id, []),
        }

    return {"nodes": [build_tree(node) for node in nodes if node.parent_id is None]}


@router.get("/{node_slug}")
def get_catalog_node(node_slug: str, db: Session = Depends(get_db)):
    node = db.query(CatalogNode).filter(
        CatalogNode.slug == node_slug,
        CatalogNode.active.is_(True),
    ).first()
    if not node:
        raise HTTPException(404, "Catalog node not found")

    children = db.query(CatalogNode).filter(
        CatalogNode.parent_id == node.id,
        CatalogNode.active.is_(True),
    ).order_by(CatalogNode.sort_order, CatalogNode.name).all()
    placements = db.query(CatalogPlacement, CatalogItem).join(
        CatalogItem, CatalogItem.id == CatalogPlacement.catalog_item_id
    ).filter(
        CatalogPlacement.catalog_node_id == node.id,
        CatalogItem.active.is_(True),
    ).order_by(CatalogPlacement.sort_order, CatalogItem.title).all()

    return {
        **_node_payload(node),
        "children": [_node_payload(child) for child in children],
        "items": [
            {**_item_payload(item), "is_primary": placement.is_primary, "sort_order": placement.sort_order}
            for placement, item in placements
        ],
    }
