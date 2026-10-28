-- Requires 0001 to 0003 (applied earlier by scripts/migrate.sh, which runs *_apply.sql in order).
BEGIN;
SELECT pg_advisory_xact_lock(42001);
SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '0004') AS already_applied \gset
\if :already_applied
  \echo '0004 already applied'
\else
  \ir 0004_catalog_online_v2.up.sql
  INSERT INTO public.schema_migrations(version) VALUES ('0004');
\endif
COMMIT;
