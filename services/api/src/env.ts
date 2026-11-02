import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  // Server-only secret. Never ship to clients, never log.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid API environment configuration: ${fields}. See services/api/.env.example`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    console.warn('[crave-api] WARNING: production NODE_ENV with a Stripe TEST key — payments are simulated.');
  }
  return parsed.data;
}
