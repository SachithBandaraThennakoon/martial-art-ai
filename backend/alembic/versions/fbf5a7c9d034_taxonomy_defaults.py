"""Add conservative default metadata to every seeded taxonomy node."""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "fbf5a7c9d034"
down_revision: Union[str, Sequence[str], None] = "fae4f6b8c923"
branch_labels = None
depends_on = None

DEFAULTS = {
    "resource_kind": "catalog_node",
    "review_status": "unreviewed",
    "publication_status": "DRAFT",
    "capabilities": {
        "learning": False,
        "guided_training": False,
        "temporal_tracking": False,
        "optimization": False,
    },
}

def upgrade() -> None:
    bind = op.get_bind()
    # jsonb concatenation preserves any existing node-specific metadata.
    bind.execute(
        sa.text(
            """UPDATE catalog_nodes
               SET metadata_json = jsonb_build_object(
                   'resource_kind', COALESCE(metadata_json->>'resource_kind', 'catalog_node'),
                   'review_status', COALESCE(metadata_json->>'review_status', 'unreviewed'),
                   'publication_status', COALESCE(metadata_json->>'publication_status', 'DRAFT'),
                   'capabilities', COALESCE(metadata_json->'capabilities', CAST(:capabilities AS jsonb))
               ) || COALESCE(metadata_json, '{}'::jsonb)
               WHERE active = true"""
        ),
        {"capabilities": '{"learning":false,"guided_training":false,"temporal_tracking":false,"optimization":false}'},
    )

def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """UPDATE catalog_nodes
               SET metadata_json = metadata_json - 'resource_kind' - 'review_status' - 'publication_status' - 'capabilities'"""
        )
    )
