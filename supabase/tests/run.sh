#!/usr/bin/env bash
# Boots a throwaway PostgreSQL cluster, applies the Supabase shim, all migrations and the seed,
# then runs the database test suite (RLS, triggers, state machine, privacy functions).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
DATA="$HERE/.pgdata"
PORT="${CRAVE_TEST_PG_PORT:-54329}"
SOCK="$(mktemp -d)"

cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA" "$SOCK"; }
trap cleanup EXIT
rm -rf "$DATA"

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown postgres "$SOCK"; mkdir -p "$DATA"; chown postgres "$DATA"
  RUN_AS="runuser -u postgres --"
fi
$RUN_AS env PATH="$PATH" initdb -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
$RUN_AS env PATH="$PATH" pg_ctl -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database crave_test" postgres
"${PSQL[@]}" -d crave_test -f "$HERE/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -d crave_test -f "$f"
done
echo "applying seed.sql"
"${PSQL[@]}" -d crave_test -f "$ROOT/supabase/seed.sql"

export CRAVE_TEST_DB_URL="postgresql://postgres@localhost:$PORT/crave_test?host=$SOCK"
cd "$ROOT"
node --test "$HERE"/*.test.mjs
