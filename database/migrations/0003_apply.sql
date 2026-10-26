-- Requires 0001 and 0002 (applied earlier by scripts/migrate.sh, which runs *_apply.sql in order).
BEGIN;
SELECT pg_advisory_xact_lock(42001);
SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '0003') AS already_applied \gset
\if :already_applied
  \echo '0003 already applied'
\else
  \ir 0003_match_sessions.up.sql
  INSERT INTO public.schema_migrations(version) VALUES ('0003');
\endif
COMMIT;
