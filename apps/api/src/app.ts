import { InteractionBatchSchema, coarsen } from '@crave/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { optionalAuth, requireAuth, type AuthVariables } from './auth';
import { db } from './db';
import { env } from './env';
import { HttpError, badRequest } from './errors';
import { ingestEvents } from './services/events';
import { buildFeed } from './services/feed';
import { getMenuItem, getRestaurantMenu } from './services/menu';
import { loadPreferences, loadTasteProfile, summariseProfile } from './services/taste';

const FeedQuery = z.object({
  kind: z.enum(['for_you', 'following', 'nearby', 'trending']).default('for_you'),
  session: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
  exclude: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean).slice(0, 200) : []))
    .pipe(z.array(z.string().uuid())),
});

export function createApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: env().CORS_ORIGINS.split(',').map((s) => s.trim()),
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: { code: 'validation_error', message: 'Invalid request', details: err.issues } }, 400);
    console.error(err);
    return c.json({ error: { code: 'internal_error', message: 'Something went wrong' } }, 500);
  });

  app.get('/health', async (c) => {
    await db()`select 1`;
    return c.json({ ok: true, service: 'crave-api' });
  });

  // --- Feed -----------------------------------------------------------------
  app.get('/v1/feed', optionalAuth, async (c) => {
    const q = FeedQuery.parse(c.req.query());
    const user = c.get('user');
    // Location is coarsened server-side too (~1 km) and never stored.
    const location = q.lat !== undefined && q.lng !== undefined ? { lat: coarsen(q.lat), lng: coarsen(q.lng) } : null;
    const feed = await buildFeed(db(), {
      userId: user?.id ?? null,
      kind: q.kind,
      sessionId: q.session,
      location,
      limit: q.limit,
      excludeVideoIds: q.exclude,
    });
    return c.json(feed);
  });

  // --- Public catalogue (active restaurants only) -----------------------------
  const Id = z.string().uuid();
  app.get('/v1/restaurants/:id', async (c) => c.json(await getRestaurantMenu(db(), Id.parse(c.req.param('id')))));
  app.get('/v1/menu-items/:id', async (c) => c.json(await getMenuItem(db(), Id.parse(c.req.param('id')))));

  // --- Interaction events ------------------------------------------------------
  app.post('/v1/events', requireAuth, async (c) => {
    const body = InteractionBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest('Invalid events', body.error.issues);
    const result = await ingestEvents(db(), c.get('user')!.id, body.data.events);
    return c.json(result, 202);
  });

  // --- Taste profile transparency & reset ----------------------------------------
  app.get('/v1/me/taste-profile', requireAuth, async (c) => {
    const userId = c.get('user')!.id;
    const [profile, prefs] = await Promise.all([loadTasteProfile(db(), userId), loadPreferences(db(), userId)]);
    return c.json({
      summary: summariseProfile(profile),
      explicitPreferences: prefs,
      dataUsed: [
        'Videos you swipe right (CRAVE IT) or left (NOT FOR ME)',
        'How long you watch videos',
        'Likes, saves, shares and comments',
        'Menu items you open and add to your basket',
        'Orders you complete (strongest signal)',
        'Food preferences you set yourself',
      ],
      notUsed: [
        'Your precise location (feed uses approximate location only, not stored)',
        'Health, allergy or religious information (only what you explicitly set as a preference)',
        'Your contacts or activity outside CRAVE',
      ],
    });
  });

  app.post('/v1/me/taste-profile/reset', requireAuth, async (c) => {
    const userId = c.get('user')!.id;
    await db().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      await tx`select public.reset_my_taste_profile()`;
    });
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  return app;
}
