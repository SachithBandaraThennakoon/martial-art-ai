# Technique file naming

This directory contains two kinds of technique records, and both use the
technique slug as the filename stem:

- Authored runtime records use the full catalog hierarchy when that path is
  known, for example `3-technique-training--punching--straight-punches--jab.json`.
  They retain the short internal runtime slug `jab`, so `/techniques/guide/jab`
  continues to work.
- Catalog-only taxonomy records use the same full hierarchy but have no authored
  training steps yet. Short runtime records remain valid for techniques that do
  not have an unambiguous taxonomy path.

Do not overwrite authored data with a placeholder. Every file must keep this
invariant:

```text
filename stem == technique.slug
or filename stem ends with --technique.slug
```

Use `python backend/scripts/validate_system_catalog_files.py` before changing
catalog data or generating snapshots.
