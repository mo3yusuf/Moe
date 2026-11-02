import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { publicBaseUrl } from '@crave/core';
import { createApp } from './app';
import { loadEnv } from './env';
import { supabaseAuthVerifier } from './lib/auth';
import { supabaseStore } from './lib/supabase-store';
import { rulesRanker } from './lib/ranker';
import { stripeProvider } from './lib/payments';
import { runBackgroundJobs } from './lib/worker';
import { sandboxDeliveryProvider } from './lib/delivery';
import { muxClient } from './lib/mux';

const env = loadEnv();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const store = supabaseStore(admin);
const payments = env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRETS
  ? stripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecrets: env.STRIPE_WEBHOOK_SECRETS.split(',').map((s) => s.trim()).filter(Boolean) })
  : null;
const delivery = env.DELIVERY_PROVIDER === 'sandbox' ? sandboxDeliveryProvider(env.DELIVERY_WEBHOOK_SECRET ?? 'sandbox-dev-secret-only') : null;
const mux = env.MUX_TOKEN_ID && env.MUX_TOKEN_SECRET && env.MUX_WEBHOOK_SECRET
  ? muxClient({ tokenId: env.MUX_TOKEN_ID, tokenSecret: env.MUX_TOKEN_SECRET, webhookSecret: env.MUX_WEBHOOK_SECRET })
  : null;
if (!mux && (env.MUX_TOKEN_ID || env.MUX_TOKEN_SECRET || env.MUX_WEBHOOK_SECRET)) {
  console.warn('[crave-api] Mux is partly configured (need MUX_TOKEN_ID, MUX_TOKEN_SECRET and MUX_WEBHOOK_SECRET) — using Supabase Storage');
}
const app = createApp({
  mux,
  auth: supabaseAuthVerifier(admin),
  store,
  ranker: rulesRanker(store, { onError: (e) => console.error('[crave-api] impression logging failed', e) }),
  paymentsMode: env.PAYMENTS_MODE,
  payments,
  delivery,
  stripeOnBehalfOf: env.STRIPE_ON_BEHALF_OF === 'true',
  webBaseUrl: publicBaseUrl(env.WEB_BASE_URL),
  corsOrigins: [...env.CORS_ORIGINS.split(','), env.APP_HOST, env.DASHBOARD_HOST].map(publicBaseUrl).filter(Boolean),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[crave-api] listening on http://localhost:${info.port} (${env.NODE_ENV}, video: ${mux ? 'mux' : 'supabase storage'})`);
});

if (env.WORKER_ENABLED === 'true') {
  let ticks = 0;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const tick = ticks++;
      const r = await runBackgroundJobs(store, payments, { runFraud: tick % 60 === 0, daily: tick % 1440 === 1, delivery, log: (m, e) => console.error(`[crave-worker] ${m}`, e ?? '') });
      if (r.expired || r.refunds.succeeded || r.refunds.pending || r.refunds.failed || r.deletions || r.fraudFlags || r.creatorPayouts || r.dispatched) console.log('[crave-worker]', JSON.stringify(r));
    } catch (e) {
      console.error('[crave-worker] run failed', e);
    } finally {
      running = false;
    }
  }, 60_000);
}
