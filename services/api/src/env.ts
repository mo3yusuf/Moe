import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  // Server-only secret. Never ship to clients, never log.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  /** Bare host names of the hosted web app and dashboard (e.g. from Render); allowed as https:// origins. */
  APP_HOST: z.string().optional(),
  DASHBOARD_HOST: z.string().optional(),
  /** simulated = development-only fake payment step; stripe = Phase 7; disabled = checkout off. */
  PAYMENTS_MODE: z.enum(['disabled', 'simulated', 'stripe']).default('disabled'),
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/).optional(),
  /** Comma-separated: platform endpoint secret and Connect endpoint secret. */
  STRIPE_WEBHOOK_SECRETS: z.string().optional(),
  /** true = restaurant is the settlement merchant (on_behalf_of). Confirm with legal/accounting. */
  STRIPE_ON_BEHALF_OF: z.enum(['true', 'false']).default('true'),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  /** Mux streaming (optional). All three set = uploads go to Mux; otherwise Supabase Storage is used. */
  MUX_TOKEN_ID: z.string().optional().transform((v) => v?.trim() || undefined),
  MUX_TOKEN_SECRET: z.string().optional().transform((v) => v?.trim() || undefined),
  MUX_WEBHOOK_SECRET: z.string().optional().transform((v) => v?.trim() || undefined),
  /** none = pickup only (default). sandbox = TEST/DEV ONLY fake partner, refused in production. */
  DELIVERY_PROVIDER: z.enum(['none', 'sandbox']).default('none'),
  DELIVERY_WEBHOOK_SECRET: z.string().min(16).optional(),
  WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid API environment configuration: ${fields}. See services/api/.env.example`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PAYMENTS_MODE === 'simulated') {
    throw new Error('PAYMENTS_MODE=simulated is not allowed in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DELIVERY_PROVIDER === 'sandbox') {
    throw new Error('DELIVERY_PROVIDER=sandbox is not allowed in production');
  }
  if (parsed.data.PAYMENTS_MODE === 'stripe' && (!parsed.data.STRIPE_SECRET_KEY || !parsed.data.STRIPE_WEBHOOK_SECRETS)) {
    throw new Error('PAYMENTS_MODE=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRETS');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    console.warn('[crave-api] WARNING: production NODE_ENV with a Stripe TEST key — payments are simulated.');
  }
  return parsed.data;
}
