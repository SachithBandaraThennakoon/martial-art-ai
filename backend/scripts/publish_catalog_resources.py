"""Publish taxonomy/catalog visibility without publishing empty learning guides."""
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as db:
    db.execute(text("""UPDATE catalog_nodes SET active=true,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || '{"catalog_status":"PUBLISHED"}'::jsonb
        WHERE slug LIKE 'martial-arts%'"""))
    db.execute(text("""UPDATE catalog_items SET active=true,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || '{"catalog_status":"PUBLISHED"}'::jsonb
        WHERE resource_type='catalog_node'"""))
print("Catalog resources published; learning guides remain unchanged.")
