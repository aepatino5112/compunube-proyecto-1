-- Requires 0001 (applied earlier by scripts/migrate.sh, which runs *_apply.sql in order).
BEGIN;
SELECT pg_advisory_xact_lock(42001);
SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '0002') AS already_applied \gset
\if :already_applied
  \echo '0002 already applied'
\else
  \ir 0002_online_catalog.up.sql
  INSERT INTO public.schema_migrations(version) VALUES ('0002');
\endif
COMMIT;
