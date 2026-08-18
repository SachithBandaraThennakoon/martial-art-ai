# Technique data authoring

The runtime source of truth is PostgreSQL. Bundled JSON packages remain the
bootstrap/fallback source and are used when creating a brand-new technique.

## Admin workflow

1. Open `/admin-manual-catalog` and select a technique.
2. Edit details, steps, poses, biomechanics, or Guide content.
3. Select **Publish**. The server validates the complete package, increments its
   semantic patch version, writes the JSONB runtime data, and creates an
   immutable `technique_revisions` snapshot.
4. Use **History** to review publications. **Restore** copies a selected snapshot
   into the live technique and records that restoration as another revision.

Published training is served by `GET /techniques/{slug}/training`; published
learning content is served by `GET /techniques/{slug}/learning`. The frontend
uses bundled JSON only when the runtime API is unavailable.

## Admin API

- `GET /admin/techniques/{slug}/runtime`
- `PUT /admin/techniques/{slug}/publish`
- `GET /admin/techniques/{slug}/revisions`
- `POST /admin/techniques/{slug}/revisions/{revision_id}/rollback`

All endpoints require an administrator session. Rollback never deletes or
rewrites revision history.
