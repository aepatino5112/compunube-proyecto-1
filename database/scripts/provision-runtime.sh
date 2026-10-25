#!/bin/sh
# Re-run after a password rotation; no credentials are stored in migration SQL.
set -eu
: "${DATABASE_URL:?}"
: "${MATCH_DB_PASSWORD:?}"
: "${PLAYER_DB_PASSWORD:?}"
: "${MONITOR_DB_PASSWORD:?}"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v match_password="$MATCH_DB_PASSWORD" \
  -v player_password="$PLAYER_DB_PASSWORD" \
  -v monitor_password="$MONITOR_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE compunube_match_runtime LOGIN PASSWORD %L', :'match_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='compunube_match_runtime') \gexec
SELECT format('CREATE ROLE compunube_player_runtime LOGIN PASSWORD %L', :'player_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='compunube_player_runtime') \gexec
SELECT format('CREATE ROLE compunube_monitor_runtime LOGIN PASSWORD %L', :'monitor_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='compunube_monitor_runtime') \gexec
SELECT format('ALTER ROLE compunube_match_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'match_password') \gexec
SELECT format('ALTER ROLE compunube_player_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'player_password') \gexec
SELECT format('ALTER ROLE compunube_monitor_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'monitor_password') \gexec
GRANT compunube_match_app TO compunube_match_runtime;
GRANT compunube_player_app TO compunube_player_runtime;
GRANT pg_monitor TO compunube_monitor_runtime;
-- Rust readiness verifies the applied schema version. This is the only
-- administrative table it can read; it cannot write migration history.
GRANT SELECT ON public.schema_migrations TO compunube_player_app;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
    JOIN pg_roles granted ON granted.oid=m.roleid
    WHERE (member.rolname='compunube_match_runtime' AND granted.rolname<>'compunube_match_app')
       OR (member.rolname='compunube_player_runtime' AND granted.rolname<>'compunube_player_app')
  ) THEN
    RAISE EXCEPTION 'runtime role has an unexpected membership';
  END IF;
END $$;
SQL
echo 'runtime PostgreSQL principals provisioned'
