#!/usr/bin/env node
// Creates loginable DEMO accounts in a LOCAL or STAGING Supabase project via the Auth Admin API.
// Never run against production. Usage:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-demo-accounts.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (process.env.CRAVE_ENV === 'production') {
  console.error('Refusing to create demo accounts in production.');
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD ?? 'crave-demo-password';
const admin = createClient(url, key, { auth: { persistSession: false } });

const accounts = [
  { email: 'customer@demo.crave.app', name: 'Demo Customer', setup: async () => {} },
  {
    email: 'owner@demo.crave.app', name: 'Demo Restaurant Owner',
    setup: async (id) => {
      // Owner of the two demo restaurants seeded in supabase/seed.sql.
      const { data: rs } = await admin.from('restaurants').select('id').in('slug', ['valley-smash-burgers', 'kurilpa-sushi-bar']);
      for (const r of rs ?? []) {
        await admin.from('restaurant_members').upsert({ restaurant_id: r.id, user_id: id, role: 'owner' });
      }
      await admin.from('user_roles').upsert({ user_id: id, role: 'restaurant_staff' });
    },
  },
  {
    email: 'admin@demo.crave.app', name: 'Demo Admin',
    setup: async (id) => { await admin.from('user_roles').upsert({ user_id: id, role: 'admin' }); },
  },
];

for (const a of accounts) {
  let userId;
  const { data, error } = await admin.auth.admin.createUser({
    email: a.email, password, email_confirm: true,
    user_metadata: { display_name: a.name, policy_version: 'demo', consents: { personalisation: true } },
  });
  if (error && !/already/i.test(error.message)) throw error;
  if (data?.user) userId = data.user.id;
  else {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    userId = list.users.find((u) => u.email === a.email)?.id;
  }
  await a.setup(userId);
  console.log(`✓ ${a.email}`);
}
console.log(`\nDemo password: ${password}  (local/staging only)`);
