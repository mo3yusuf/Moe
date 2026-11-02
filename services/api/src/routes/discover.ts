import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { badRequest, forbidden, notFound } from '../lib/errors';

const NearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  q: z.string().trim().max(60).optional(),
  maxKm: z.coerce.number().min(1).max(50).default(15),
});
const Id = z.uuid();

export const discoverRoutes = new Hono<AppEnv>();

discoverRoutes.get('/restaurants', async (c) => {
  const parsed = NearbyQuery.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('Invalid search');
  const { store } = c.get('deps');
  const userId = c.get('user').id;
  const query = parsed.data.q || undefined;
  const items = await store.nearbyRestaurants({ ...parsed.data, query, limit: 50 });
  // Searches are a recommendation signal — only stored with personalisation consent.
  if (query && (await store.hasConsent(userId, 'personalisation'))) {
    store.logSearch(userId, query, items.length).catch(() => {});
  }
  return c.json({ items });
});

discoverRoutes.get('/restaurants/:id', async (c) => {
  const id = Id.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Restaurant');
  const detail = await c.get('deps').store.restaurantDetail(id.data, c.get('user').id);
  if (!detail) throw notFound('Restaurant');
  return c.json(detail);
});

discoverRoutes.put('/restaurants/:id/follow', async (c) => {
  const id = Id.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Restaurant');
  const body = z.object({ follow: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw badRequest('Invalid body');
  await c.get('deps').store.setFollow(c.get('user').id, id.data, body.data.follow);
  return c.json({ following: body.data.follow });
});

discoverRoutes.get('/menu-items/:id', async (c) => {
  const id = Id.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Menu item');
  const item = await c.get('deps').store.menuItemDetail(id.data);
  if (!item) throw notFound('Menu item');
  return c.json(item);
});

// --- Admin: video moderation ------------------------------------------------------------
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  if (!(await c.get('deps').store.isAdmin(c.get('user').id))) throw forbidden('Administrators only');
  await next();
});

adminRoutes.get('/videos', async (c) => {
  const status = z.enum(['pending_review', 'published', 'rejected']).catch('pending_review').parse(c.req.query('status'));
  return c.json({ items: await c.get('deps').store.listVideosForModeration(status, 50) });
});

adminRoutes.post('/videos/:id/moderate', async (c) => {
  const id = Id.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('Video');
  const body = z.object({
    decision: z.enum(['publish', 'reject', 'remove']),
    notes: z.string().trim().max(500).nullish(),
  }).refine((b) => b.decision === 'publish' || !!b.notes, 'A reason is required to reject or remove')
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw badRequest(body.error.issues[0]?.message ?? 'Invalid body');
  const result = await c.get('deps').store.moderateVideo(c.get('user').id, id.data, body.data.decision, body.data.notes ?? null);
  if (result === 'not_found') throw notFound('Video');
  if (result === 'missing_upload') throw badRequest('The video file has not finished uploading', 'missing_upload');
  return c.json({ ok: true });
});
