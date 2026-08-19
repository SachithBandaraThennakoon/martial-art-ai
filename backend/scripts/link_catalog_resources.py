import os
from sqlalchemy import create_engine, text

with create_engine(os.environ["DATABASE_URL"]).begin() as db:
    db.execute(text("""INSERT INTO catalog_placements (catalog_item_id,catalog_node_id,is_primary,sort_order)
        SELECT ci.id, ci.resource_id, true, 0
        FROM catalog_items ci
        WHERE ci.resource_type='catalog_node'
        ON CONFLICT (catalog_item_id,catalog_node_id) DO NOTHING"""))
    print("Catalog resources linked to taxonomy nodes.")
