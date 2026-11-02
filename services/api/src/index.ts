import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { loadEnv } from './env';
import { supabaseAuthVerifier } from './lib/auth';
import { supabaseStore } from './lib/supabase-store';

const env = loadEnv();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createApp({
  auth: supabaseAuthVerifier(admin),
  store: supabaseStore(admin),
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[crave-api] listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});
