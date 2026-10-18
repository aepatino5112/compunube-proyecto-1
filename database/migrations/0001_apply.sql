-- Administrative history is the only table outside the E41 business schemas.
BEGIN;
SELECT pg_advisory_xact_lock(42001);
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '0001') AS already_applied \gset
\if :already_applied
  \echo '0001 already applied'
\else
  \ir 0001_schema.up.sql
  INSERT INTO public.schema_migrations(version) VALUES ('0001');
\endif
COMMIT;
