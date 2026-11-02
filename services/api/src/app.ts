import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { AuthVerifier, AuthedUser } from './lib/auth';
import type { DataStore } from './lib/store';
import { ApiError, notFound } from './lib/errors';

export interface AppDeps {
  auth: AuthVerifier;
  store: DataStore;
  corsOrigins: string[];
  now?: () => Date;
}

export type AppEnv = { Variables: { user: AuthedUser; deps: AppDeps } };

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: deps.corsOrigins, allowHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }));
  app.use('*', async (c, next) => { c.set('deps', deps); await next(); });

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

  app.get('/v1/me', async (c) => {
    const me = await deps.store.getMe(c.get('user').id);
    if (!me) throw notFound('Profile');
    return c.json(me);
  });

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
