#!/usr/bin/env node
/**
 * Fails if a real-looking secret is committed: Supabase access tokens and service keys, Stripe,
 * Resend, Sentry auth tokens, Mux secrets, GitHub tokens, AWS keys, private keys, and database URLs
 * with passwords. Scans every tracked file (and, with --history, every commit). Runs in CI.
 * Test fixtures with obviously fake values are fine; real keys belong in Render / Claude env settings.
 */
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  ['Supabase access token', /sbp_[a-f0-9]{30,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/],
  ['JWT (e.g. Supabase service_role key)', /eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['Stripe secret/restricted key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]{24,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['Sentry auth token', /\bsntrys_[A-Za-z0-9+/=_-]{20,}/],
  ['GitHub token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Database URL with password', /postgres(ql)?:\/\/[^:\s/]+:(?!\$|<|\*|password|PASSWORD|YOUR)[^@\s]{6,}@[^\s'"]*supabase/],
];
const SKIP = [/^package-lock\.json$/, /\.png$|\.jpg$|\.webp$|\.ico$/, /^scripts\/check-secrets\.mjs$/];

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const findings = [];
function scan(label, text) {
  for (const [name, re] of PATTERNS) {
    const m = text.match(re);
    if (m) findings.push(`${label}: ${name} (${m[0].slice(0, 12)}…)`);
  }
}

if (process.argv.includes('--history')) {
  scan('git history', git(['log', '--all', '-p', '--no-color', '--', '.', ':(exclude)package-lock.json', ':(exclude)scripts/check-secrets.mjs']));
} else {
  for (const file of git(['ls-files']).split('\n').filter(Boolean)) {
    if (SKIP.some((re) => re.test(file))) continue;
    try { scan(file, git(['show', `:${file}`])); } catch { /* deleted or binary */ }
  }
}

if (findings.length) {
  console.error('✗ Possible secrets found — remove them and rotate the keys:\n  ' + findings.join('\n  '));
  process.exit(1);
}
console.log(`✓ No secrets found (${process.argv.includes('--history') ? 'full git history' : 'tracked files'})`);
