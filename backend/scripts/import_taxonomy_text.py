"""Import a box-drawing taxonomy document into DB as draft catalog resources."""
import re, sys
from sqlalchemy import create_engine, text

def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")

def main(path, database_url):
    lines = open(path, encoding="utf-8").read().splitlines()
    engine = create_engine(database_url)
    with engine.begin() as db:
        parents = {}
        for raw in lines:
            match = re.search(r"(?:├──|└──)\s*(.+)$", raw)
            if not match:
                continue
            name = re.sub(r"^\d+(?:\.\d+)*\s+", "", match.group(1).strip())
            prefix = raw[:match.start()]
            depth = prefix.count("│") + prefix.count("    ")
            depth = max(0, depth)
            parent = parents.get(depth - 1)
            node_slug = slug(name)
            if parent:
                node_slug = f"{parent}--{node_slug}"
            node_id = db.execute(text("""INSERT INTO catalog_nodes (slug,name,parent_id,node_type,sort_order,active,metadata_json)
                SELECT :slug,:name,id,'category',0,true,CAST(:meta AS jsonb) FROM catalog_nodes WHERE slug=:parent
                ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,active=true RETURNING id"""),
                {"slug": node_slug, "name": name, "parent": parent or "martial-arts", "meta": '{"resource_kind":"catalog_node","review_status":"unreviewed","publication_status":"DRAFT","capabilities":{"learning":false,"guided_training":false,"temporal_tracking":false,"optimization":false}}'}).scalar()
            parents[depth] = node_slug
            for key in list(parents):
                if key > depth: del parents[key]
            # Every imported node is available as a catalog resource; authored
            # runtime rows are created separately by the admin workflow.
            db.execute(text("""INSERT INTO catalog_items (slug,title,resource_type,resource_id,active,metadata_json)
                VALUES (:slug,:name,'catalog_node',:id,true,CAST(:meta AS jsonb))
                ON CONFLICT (slug) DO NOTHING"""), {"slug": f"catalog-{node_slug}", "name": name, "id": node_id, "meta": '{"publication_status":"DRAFT","review_status":"unreviewed"}'})

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
