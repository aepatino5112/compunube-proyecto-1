#!/bin/sh
# Positive own-schema and negative cross-schema DML with actual LOGIN users.
set -eu
: "${POSTGRES_DB:?}"
: "${MATCH_DB_PASSWORD:?}"
: "${PLAYER_DB_PASSWORD:?}"
query() {
  role=$1 password=$2 statement=$3
  PGPASSWORD="$password" psql -h postgres -U "$role" -d "$POSTGRES_DB" -X -qAt -v ON_ERROR_STOP=1 -c "$statement"
}
query compunube_match_runtime "$MATCH_DB_PASSWORD" 'SELECT count(*) FROM match.rooms' >/dev/null
query compunube_player_runtime "$PLAYER_DB_PASSWORD" 'SELECT count(*) FROM player.profiles' >/dev/null
query compunube_player_runtime "$PLAYER_DB_PASSWORD" 'SELECT count(*) FROM public.schema_migrations' >/dev/null
if query compunube_match_runtime "$MATCH_DB_PASSWORD" 'SELECT count(*) FROM public.schema_migrations' >/dev/null 2>&1; then
  echo 'match runtime unexpectedly read migration history' >&2; exit 1
fi
for operation in SELECT INSERT UPDATE DELETE; do
  case "$operation" in
    SELECT) match_sql='SELECT * FROM player.profiles LIMIT 1'; player_sql='SELECT * FROM match.rooms LIMIT 1' ;;
    INSERT) match_sql="INSERT INTO player.profiles(player_id) VALUES ('j84-forbidden')"; player_sql="INSERT INTO match.rooms(room_id,map_id) VALUES ('j84-forbidden','maracaibo')" ;;
    UPDATE) match_sql='UPDATE player.profiles SET coins=coins WHERE false'; player_sql='UPDATE match.rooms SET map_id=map_id WHERE false' ;;
    DELETE) match_sql='DELETE FROM player.profiles WHERE false'; player_sql='DELETE FROM match.rooms WHERE false' ;;
  esac
  if query compunube_match_runtime "$MATCH_DB_PASSWORD" "$match_sql" >/dev/null 2>&1; then
    echo "match runtime unexpectedly allowed $operation on player.*" >&2; exit 1
  fi
  if query compunube_player_runtime "$PLAYER_DB_PASSWORD" "$player_sql" >/dev/null 2>&1; then
    echo "player runtime unexpectedly allowed $operation on match.*" >&2; exit 1
  fi
done
query compunube_match_runtime "$MATCH_DB_PASSWORD" "BEGIN; INSERT INTO match.rooms(room_id,map_id) VALUES ('j84-own-match','maracaibo'); UPDATE match.rooms SET map_id='maracaibo' WHERE room_id='j84-own-match'; DELETE FROM match.rooms WHERE room_id='j84-own-match'; ROLLBACK" >/dev/null
query compunube_player_runtime "$PLAYER_DB_PASSWORD" "BEGIN; INSERT INTO player.profiles(player_id) VALUES ('j84-own-player'); UPDATE player.profiles SET coins=1 WHERE player_id='j84-own-player'; DELETE FROM player.profiles WHERE player_id='j84-own-player'; ROLLBACK" >/dev/null
echo 'runtime PostgreSQL own-schema and cross-schema access: PASS'
