#!/usr/bin/env node
// Grants the CRAVE admin role to an existing account (they must have signed up in the app first).
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/make-admin.mjs person@example.com
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2]?.toLowerCase();
const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
if (!email || !url || !key) { console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/make-admin.mjs <email>'); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
let page = 1, user;
while (!user) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (data.users.length < 200) break;
  page += 1;
}
if (!user) { console.error(`No account for ${email}. Sign up in the app first.`); process.exit(1); }
const { error } = await admin.from('user_roles').upsert({ user_id: user.id, role: 'admin' });
if (error) throw error;
await admin.from('audit_log').insert({ actor_id: null, action: 'admin_granted', entity_type: 'user', entity_id: user.id, details: { via: 'make-admin script' } });
console.log(`✓ ${email} is now a CRAVE admin`);
