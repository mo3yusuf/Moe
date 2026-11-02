import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { loadEnv } from './env';
import { supabaseAuthVerifier } from './lib/auth';
import { supabaseStore } from './lib/supabase-store';
import { rulesRanker } from './lib/ranker';
import { stripeProvider } from './lib/payments';
import { runBackgroundJobs } from './lib/worker';

const env = loadEnv();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const store = supabaseStore(admin);
const payments = env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRETS
  ? stripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecrets: env.STRIPE_WEBHOOK_SECRETS.split(',').map((s) => s.trim()).filter(Boolean) })
  : null;
const app = createApp({
  auth: supabaseAuthVerifier(admin),
  store,
  ranker: rulesRanker(store, { onError: (e) => console.error('[crave-api] impression logging failed', e) }),
  paymentsMode: env.PAYMENTS_MODE,
  payments,
  stripeOnBehalfOf: env.STRIPE_ON_BEHALF_OF === 'true',
  webBaseUrl: env.WEB_BASE_URL,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[crave-api] listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});

if (env.WORKER_ENABLED === 'true') {
  let ticks = 0;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runBackgroundJobs(store, payments, { runFraud: ticks++ % 60 === 0, log: (m, e) => console.error(`[crave-worker] ${m}`, e ?? '') });
      if (r.expired || r.refunds.succeeded || r.refunds.pending || r.refunds.failed || r.deletions || r.fraudFlags) console.log('[crave-worker]', JSON.stringify(r));
    } catch (e) {
      console.error('[crave-worker] run failed', e);
    } finally {
      running = false;
    }
  }, 60_000);
}
