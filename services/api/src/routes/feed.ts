import { toFeedItem, type FeedResponse } from '@crave/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { badRequest } from '../lib/errors';

const FeedQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  cityId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  exclude: z.string().max(4000).optional(), // comma-separated video ids already shown this session
});

export const feedRoutes = new Hono<AppEnv>();

feedRoutes.get('/feed', async (c) => {
  const parsed = FeedQuery.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('Invalid feed parameters');
  const q = parsed.data;
  const { store, ranker } = c.get('deps');
  const userId = c.get('user').id;

  const exclude = new Set((q.exclude ?? '').split(',').filter(Boolean));
  const [candidates, personalised] = await Promise.all([
    store.feedCandidates({ cityId: q.cityId, lat: q.lat, lng: q.lng, maxKm: 30, limit: 400 }),
    store.hasConsent(userId, 'personalisation'),
  ]);
  const pool = candidates.filter((cand) => !exclude.has(cand.videoId));
  const ranked = await ranker.rank({ userId, personalised, candidates: pool, limit: q.limit, now: c.get('deps').now?.() ?? new Date() });

  const ids = ranked.items.map((r) => r.candidate.videoId);
  const viewer = await store.viewerVideoState(userId, ids);
  const body: FeedResponse = {
    feedRequestId: ranked.feedRequestId,
    modelVersion: ranked.modelVersion,
    personalised,
    items: ranked.items.map((r) => toFeedItem(r.candidate, {
      liked: viewer.liked.has(r.candidate.videoId),
      saved: viewer.saved.has(r.candidate.videoId),
      craved: viewer.craved.has(r.candidate.videoId),
    }, r.ranking)),
  };
  return c.json(body);
});

feedRoutes.get('/saved', async (c) => {
  const collection = c.req.query('collection') === 'saved' ? 'saved' : 'cravings';
  const rows = await c.get('deps').store.listSaved(c.get('user').id, collection);
  return c.json({ collection, items: rows });
});
