import os
from sqlalchemy import create_engine, text

with create_engine(os.environ["DATABASE_URL"]).begin() as db:
    db.execute(text("""UPDATE catalog_items
        SET metadata_json = (COALESCE(metadata_json,'{}'::jsonb) - 'runtime_technique_slug')
          || jsonb_build_object('runtime_ready',false)
        WHERE resource_type='catalog_node'"""))
    db.execute(text("""UPDATE catalog_items ci
        SET metadata_json = ci.metadata_json || jsonb_build_object(
            'runtime_ready', true,
            'runtime_technique_slug', (
                SELECT t.slug
                FROM techniques t
                WHERE lower(t.name) = lower(ci.title)
                  AND COALESCE(t.metadata_json->>'catalog_only', 'false') <> 'true'
                  AND jsonb_array_length(COALESCE(t.training_config->'steps','[]'::jsonb)) > 0
                ORDER BY t.id
                LIMIT 1
            )
        )
        WHERE ci.resource_type='catalog_node'
          AND EXISTS (
              SELECT 1 FROM techniques t
              WHERE lower(t.name) = lower(ci.title)
                AND COALESCE(t.metadata_json->>'catalog_only', 'false') <> 'true'
                AND jsonb_array_length(COALESCE(t.training_config->'steps','[]'::jsonb)) > 0
          )"""))
    print("Catalog runtime readiness updated.")
