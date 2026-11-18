#!/usr/bin/env node
/**
 * Applies database migrations (supabase/migrations/*.sql) in filename order, each exactly once,
 * each in its own transaction, recording them in public._crave_migrations. Runs automatically on
 * every crave-api deploy (Render pre-deploy command) — no more pasting SQL into the editor.
 *
 * Env: DATABASE_URL — the Supabase "Session pooler" connection string (Project Settings → Database).
 * Options: --dry-run (list pending, change nothing), --seed-reference (also load reference.sql once).
 *
 * Safety: an advisory lock stops two deploys migrating at once; a failed migration rolls back and
 * stops the deploy, so the old version keeps serving. Migrations that were applied by hand before
 * this runner existed are detected by a probe and recorded instead of re-run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase/migrations');
const dry = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (Supabase → Project Settings → Database → Session pooler connection string).'); process.exit(1); }

/** Migrations that were pasted into the SQL editor before automatic migrations existed. */
const ALREADY_APPLIED_PROBES = {
  '20261102000020_crave_match.sql': `select to_regclass('public.crave_rooms') is not null as ok`,
  '20261102000021_menu_customisation.sql': `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_item_options' and column_name = 'max_quantity') as ok`,
};

const isLocal = /@(localhost|127\.0\.0\.1)|host=\//.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false }, application_name: 'crave-migrate' });
await client.connect();
try {
  await client.query(`select pg_advisory_lock(727274)`); // one migrator at a time
  await client.query(`create table if not exists public._crave_migrations (name text primary key, applied_at timestamptz not null default now());
                      alter table public._crave_migrations enable row level security;
                      revoke all on public._crave_migrations from anon, authenticated;`);
  const applied = new Set((await client.query('select name from public._crave_migrations')).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const pending = files.filter((f) => !applied.has(f));
  console.log(`[migrate] ${files.length} migrations, ${pending.length} pending${dry ? ' (dry run)' : ''}`);

  for (const f of pending) {
    const probe = ALREADY_APPLIED_PROBES[f];
    if (probe && (await client.query(probe)).rows[0]?.ok) {
      if (!dry) await client.query('insert into public._crave_migrations (name) values ($1)', [f]);
      console.log(`[migrate] ✓ ${f} (already applied by hand — recorded)`);
      continue;
    }
    if (dry) { console.log(`[migrate] → would apply ${f}`); continue; }
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into public._crave_migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log(`[migrate] ✓ ${f}`);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.error(`[migrate] ✗ ${f} failed and was rolled back: ${e.message}`);
      process.exitCode = 1;
      break; // later migrations may depend on this one
    }
  }

  if (!dry && process.exitCode !== 1 && process.argv.includes('--seed-reference')) {
    const done = (await client.query(`select 1 from public._crave_migrations where name = 'reference.sql'`)).rowCount;
    if (!done) {
      await client.query('begin');
      await client.query(readFileSync(join(root, 'supabase/reference.sql'), 'utf8'));
      await client.query(`insert into public._crave_migrations (name) values ('reference.sql')`);
      await client.query('commit');
      console.log('[migrate] ✓ reference data');
    }
  }
} finally {
  await client.query(`select pg_advisory_unlock(727274)`).catch(() => {});
  await client.end();
}
if (process.exitCode === 1) console.error('[migrate] stopped — the deploy will not go live until this is fixed.');
else console.log('[migrate] database is up to date');
