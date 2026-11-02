#!/usr/bin/env bash
# Recreates a LOCAL PostgreSQL database with a Supabase-like shim, all
# migrations and the demo seed. Used by the automated DB/RLS tests.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/crave_test scripts/db-local-reset.sh
#
# For a real Supabase stack use `supabase db reset` instead (see README).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/crave_test}"
DB_NAME="${DB_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL="${DB_URL%/*}/postgres"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB_NAME\" with (force);" -c "create database \"$DB_NAME\";"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/local-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"
echo "Local database $DB_NAME ready."
