#!/usr/bin/env node
/**
 * Sets up a hosted Supabase project for CRAVE: applies every migration in order (once each),
 * loads reference data (NOT demo data), and configures auth redirect URLs.
 *
 * Uses the Supabase Management API over HTTPS, so it works where direct Postgres connections don't.
 * Required env:
 *   SUPABASE_URL            https://<project-ref>.supabase.co
 *   SUPABASE_ACCESS_TOKEN   personal access token (supabase.com → Account → Access Tokens).
 *                           May be omitted when a network proxy injects the Authorization header
 *                           for api.supabase.com (e.g. a Claude Code "network secret").
 * Optional:
 *   ADMIN_EMAIL             grant the CRAVE admin role to this (already signed-up) account and stop
 *   APP_URL                 public URL of the web app (for sign-up confirmation links)
 *   DRY_RUN=1               list what would run without changing anything
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.SUPABASE_URL ?? '';
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)?.[1];
if (!ref) {
  console.error('Set SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_ACCESS_TOKEN.');
  process.exit(1);
}
const dry = process.env.DRY_RUN === '1';
const api = `https://api.supabase.com/v1/projects/${ref}`;
const authHeaders = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

async function sql(query) {
  const res = await fetch(`${api}/database/query`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (adminEmail) {
  if (!/^[^\s@']+@[^\s@']+$/.test(adminEmail)) { console.error('ADMIN_EMAIL looks invalid.'); process.exit(1); }
  const rows = await sql(`with u as (select id from auth.users where lower(email) = '${adminEmail}'),
    granted as (insert into public.user_roles (user_id, role) select id, 'admin' from u on conflict do nothing returning user_id)
    select (select count(*) from u)::int as found`);
  if (!rows[0].found) { console.error(`No account for ${adminEmail}. Sign up in the app first.`); process.exit(1); }
  await sql(`insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    select null, 'admin_granted', 'user', id::text, '{"via":"setup-supabase script"}'::jsonb from auth.users where lower(email) = '${adminEmail}'`);
  console.log(`✓ ${adminEmail} is now a CRAVE admin`);
  process.exit(0);
}

const migrations = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
console.log(`Project ${ref}: ${migrations.length} migrations found${dry ? ' (dry run)' : ''}`);

if (!dry) {
  await sql(`create table if not exists public._crave_migrations (name text primary key, applied_at timestamptz not null default now());
             alter table public._crave_migrations enable row level security;
             revoke all on public._crave_migrations from anon, authenticated;`);
}
const applied = dry ? [] : (await sql('select name from public._crave_migrations')).map((r) => r.name);

for (const m of migrations) {
  if (applied.includes(m)) { console.log(`  ✓ ${m} (already applied)`); continue; }
  if (dry) { console.log(`  → would apply ${m}`); continue; }
  const body = readFileSync(join(root, 'supabase/migrations', m), 'utf8');
  // Each migration and its bookkeeping row run in one transaction: all or nothing.
  await sql(`begin;\n${body}\ninsert into public._crave_migrations (name) values ('${m.replace(/'/g, "''")}');\ncommit;`);
  console.log(`  ✓ ${m} applied`);
}

if (!dry) {
  await sql(readFileSync(join(root, 'supabase/reference.sql'), 'utf8'));
  console.log('  ✓ reference data (Brisbane, settings)');
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  if (appUrl) {
    const res = await fetch(`${api}/config/auth`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ site_url: appUrl, uri_allow_list: `${appUrl}/**,crave://**`, password_min_length: 10 }),
    });
    console.log(res.ok ? `  ✓ auth redirect URL set to ${appUrl}` : `  ! could not update auth settings (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const check = await sql(`select count(*)::int as tables, sum(case when c.relrowsecurity then 1 else 0 end)::int as rls
                           from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_crave_migrations'`);
  console.log(`  ✓ ${check[0].tables} tables, ${check[0].rls} with row-level security`);
}
console.log('Done.');
