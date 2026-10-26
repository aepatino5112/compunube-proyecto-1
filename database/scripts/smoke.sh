#!/bin/sh
set -eu
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PGPASSWORD="$POSTGRES_PASSWORD"
export DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$POSTGRES_DB"
backup_file=/tmp/e42-smoke.dump
restore_db=e42_restore_smoke
clean_db=e42_clean_smoke
trap 'dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true; dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --if-exists "$clean_db" >/dev/null 2>&1 || true; rm -f "$backup_file"' EXIT

attempt=0
until pg_isready -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { echo 'PostgreSQL TCP did not become ready' >&2; exit 1; }
  sleep 1
done

createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$clean_db"
DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$clean_db" sh "$script_dir/migrate.sh" >/dev/null
[ "$(psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$clean_db" -X -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('match','player')")" = 14 ]

sh "$script_dir/migrate.sh"
sh "$script_dir/seed.sh"
sh "$script_dir/seed.sh" >/dev/null
before=$(psql "$DATABASE_URL" -X -At -c 'SELECT count(*) FROM public.schema_migrations')
sh "$script_dir/migrate.sh"
after=$(psql "$DATABASE_URL" -X -At -c 'SELECT count(*) FROM public.schema_migrations')
[ "$before" = 3 ] && [ "$after" = 3 ]
[ "$(psql "$DATABASE_URL" -X -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('match','player')")" = 14 ]
[ "$(psql "$DATABASE_URL" -X -At -c 'SELECT count(*) FROM player.item_definitions')" = 22 ]
# F52 (0002): published active online-v1 catalog covering all 22 items, and stored rejections.
[ "$(psql "$DATABASE_URL" -X -At -c "SELECT count(*) FROM player.catalog_versions WHERE catalog_version = 'online-v1' AND active AND published_at IS NOT NULL")" = 1 ]
[ "$(psql "$DATABASE_URL" -X -At -c "SELECT count(*) FROM player.catalog_entries WHERE catalog_version = 'online-v1' AND enabled")" = 22 ]
[ "$(psql "$DATABASE_URL" -X -At -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'player' AND table_name = 'economic_operations' AND column_name = 'rejection_code'")" = 1 ]

# Negative constraints and cross-schema DML must fail without leaving rows.
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO player.profiles(player_id, coins) VALUES ('e42-negative', -1)" >/dev/null 2>&1; then
  echo 'negative balance was accepted' >&2; exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_match_app; INSERT INTO player.profiles(player_id) VALUES ('e42-forbidden'); ROLLBACK" >/dev/null 2>&1; then
  echo 'match role wrote player schema' >&2; exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_player_app; INSERT INTO match.rooms(room_id,map_id) VALUES ('e42-forbidden','maracaibo'); ROLLBACK" >/dev/null 2>&1; then
  echo 'player role wrote match schema' >&2; exit 1
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_match_app; INSERT INTO match.rooms(room_id,map_id) VALUES ('e42-allowed','maracaibo'); ROLLBACK" >/dev/null
# F48 (0003): Go stores session token hashes (32 bytes only); Rust cannot read them.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_match_app; INSERT INTO match.sessions(token_hash,player_id) VALUES (sha256('f48-smoke'),'f48-allowed'); ROLLBACK" >/dev/null
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.sessions(token_hash,player_id) VALUES ('raw-token','f48-raw')" >/dev/null 2>&1; then
  echo 'a value that is not a SHA-256 hash was stored as a session' >&2; exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_player_app; SELECT count(*) FROM match.sessions; ROLLBACK" >/dev/null 2>&1; then
  echo 'player role read match sessions' >&2; exit 1
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "BEGIN; SET ROLE compunube_player_app; INSERT INTO player.profiles(player_id) VALUES ('e42-allowed'); ROLLBACK" >/dev/null

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.rooms(room_id,map_id) VALUES ('e42-backup-fixture','maracaibo')"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.races(race_id,room_id,rules_version,course_version,started_at) VALUES ('e42-race','e42-backup-fixture','surf-mvp-1','e42-course',now())"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.race_participants(race_id,player_id,outcome,rank,finish_time_ms,collected_plastic,credited_plastic,reduce_choice) VALUES ('e42-race','e42-p1','finished',1,100,1,1,'reusable')"
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.race_participants(race_id,player_id,outcome,rank,finish_time_ms,reduce_choice) VALUES ('e42-race','e42-p2','finished',1,120,'disposable')" >/dev/null 2>&1; then
  echo 'duplicate race rank was accepted' >&2; exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO match.race_participants(race_id,player_id,outcome,collected_plastic,credited_plastic,reduce_choice) VALUES ('e42-race','e42-p2','dnf',1,1,'disposable')" >/dev/null 2>&1; then
  echo 'DNF credit was accepted' >&2; exit 1
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO player.profiles(player_id) VALUES ('e42-player')"
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO player.economic_operations(player_id,request_id,operation_type,request_fingerprint,status,rejection_code) VALUES ('e42-player','e52-bad-rejection','buy','fp','rejected','MADE_UP')" >/dev/null 2>&1; then
  echo 'unknown rejection code was accepted' >&2; exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO player.equipment_slots(player_id,slot,item_id) VALUES ('e42-player','board','coral')" >/dev/null 2>&1; then
  echo 'unowned equipment was accepted' >&2; exit 1
fi
sh "$script_dir/backup.sh" "$backup_file"
createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$restore_db"
DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$restore_db" RESTORE_CONFIRM=YES sh "$script_dir/restore.sh" "$backup_file"
[ "$(psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$restore_db" -X -At -c "SELECT count(*) FROM match.rooms WHERE room_id='e42-backup-fixture'")" = 1 ]
[ "$(psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$restore_db" -X -At -c 'SELECT count(*) FROM public.schema_migrations')" = 3 ]
echo 'E42/F52/F48 migration, permissions, backup and restore smoke: PASS'
