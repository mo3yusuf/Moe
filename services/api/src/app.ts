import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { AuthVerifier, AuthedUser } from './lib/auth';
import type { DataStore } from './lib/store';
import type { Ranker } from './lib/ranker';
import { feedRoutes } from './routes/feed';
import { eventRoutes } from './routes/events';
import { tasteRoutes } from './routes/taste';
import { adminRoutes, discoverRoutes } from './routes/discover';
import { orderRoutes } from './routes/orders';
import { adminPaymentRoutes, paymentRoutes } from './routes/payments';
import { webhookRoutes } from './routes/webhooks';
import type { PaymentProvider } from './lib/payments';
import type { DeliveryProvider } from './lib/delivery';
import { creatorRoutes } from './routes/creators';
import { muxWebhookRoutes, videoUploadRoutes } from './routes/videos';
import type { MuxClient } from './lib/mux';
import { clientIp, rateLimit } from './lib/rate-limit';
import { ApiError, notFound } from './lib/errors';

export interface AppDeps {
  auth: AuthVerifier;
  store: DataStore;
  ranker: Ranker;
  paymentsMode: 'disabled' | 'simulated' | 'stripe';
  payments?: PaymentProvider | null;
  /** Delivery partner adapter; null = pickup only. */
  delivery?: DeliveryProvider | null;
  stripeOnBehalfOf?: boolean;
  webBaseUrl?: string;
  /** Set false in tests that exercise many requests. */
  rateLimits?: boolean;
  corsOrigins: string[];
  /** Mux streaming; null = videos are served from Supabase Storage as uploaded. */
  mux?: MuxClient | null;
  now?: () => Date;
}

export type AppEnv = { Variables: { user: AuthedUser; deps: AppDeps } };

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: deps.corsOrigins, allowHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }));
  app.use('*', async (c, next) => { c.set('deps', deps); await next(); });

  // Stripe webhooks: unauthenticated (signature-verified), mounted before the /v1 auth middleware.
  app.route('/webhooks', webhookRoutes);
  app.route('/webhooks', muxWebhookRoutes);

  app.get('/health', (c) => c.json({ ok: true, service: 'crave-api', time: (deps.now?.() ?? new Date()).toISOString() }));

  // Everything under /v1 requires a valid Supabase access token.
  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new ApiError(401, 'unauthenticated', 'Sign in required');
    const user = await deps.auth.verify(token);
    if (!user) throw new ApiError(401, 'invalid_token', 'Session expired — please sign in again');
    c.set('user', user);
    await next();
  });

  if (deps.rateLimits !== false) {
    const byUser = (c: any) => c.get('user')?.id ?? clientIp(c);
    app.use('/v1/*', rateLimit({ name: 'api', capacity: 120, refillPerSecond: 2, key: byUser }));
    app.use('/v1/events', rateLimit({ name: 'events', capacity: 30, refillPerSecond: 0.5, key: byUser }));
    app.use('/v1/checkout', rateLimit({ name: 'checkout', capacity: 5, refillPerSecond: 1 / 30, key: byUser }));
    app.use('/v1/basket/*', rateLimit({ name: 'basket', capacity: 30, refillPerSecond: 0.5, key: byUser }));
  }

  app.get('/v1/me', async (c) => {
    const me = await deps.store.getMe(c.get('user').id);
    if (!me) throw notFound('Profile');
    return c.json(me);
  });

  app.route('/v1', feedRoutes);
  app.route('/v1', eventRoutes);
  app.route('/v1', tasteRoutes);
  app.route('/v1', discoverRoutes);
  app.route('/v1', orderRoutes);
  app.route('/v1', paymentRoutes);
  app.route('/v1', creatorRoutes);
  app.route('/v1', videoUploadRoutes);
  app.route('/v1/admin', adminPaymentRoutes);
  app.route('/v1/admin', adminRoutes);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof HTTPException) return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
    // Do not leak internals to clients.
    console.error('[crave-api] unhandled error', err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });

  return app;
}
