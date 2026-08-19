"""Materialize catalog resources as draft technique shells without overwriting authored rows."""
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as db:
    rows = db.execute(text("""SELECT ci.slug, ci.title
        FROM catalog_items ci
        WHERE ci.resource_type='catalog_node' AND ci.active=true""")).mappings().all()
    created = 0
    for row in rows:
        slug = row["slug"].replace("catalog-", "", 1)[:128].strip("-")
        if not slug:
            continue
        exists = db.execute(text("SELECT 1 FROM techniques WHERE slug=:slug"), {"slug": slug}).scalar()
        if exists:
            continue
        db.execute(text("""INSERT INTO techniques
            (slug,name,category,subcategory,difficulty,price,required_plan,description,status,version,training_config,learning_content,metadata_json)
            VALUES (:slug,:name,'MARTIAL ARTS','Catalog', 'Beginner',0,'FREE_PLAN',:description,'active','1.0.0',
            '{"steps":[]}'::jsonb,NULL,
            jsonb_build_object('runtime_source','postgresql','catalog_only',true,'review_status','unreviewed','publication_status','DRAFT','capabilities',jsonb_build_object('learning',false,'guided_training',false,'temporal_tracking',false,'optimization',false)))"""),
            {"slug": slug, "name": row["title"], "description": f"Catalog placeholder for {row['title']}. Training content has not been authored yet."})
        created += 1
    print(f"Created {created} catalog-only technique shells.")
