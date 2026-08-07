import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
url = os.getenv('DATABASE_URL')
print('DATABASE_URL=', url)
if not url:
    raise SystemExit('DATABASE_URL not set')
engine = create_engine(url)
with engine.connect() as conn:
    print('alembic_version=', [row[0] for row in conn.execute(text('SELECT version_num FROM alembic_version')).fetchall()])
    print('rate_limit_buckets=', conn.execute(text("SELECT to_regclass('public.rate_limit_buckets')")).scalar())
    print('tables=', [row[0] for row in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).fetchall()])
