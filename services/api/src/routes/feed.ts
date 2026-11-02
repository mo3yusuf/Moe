import { satisfiesDietary, toFeedItem, type FeedResponse } from '@crave/core';
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
  mode: z.enum(['for_you', 'following']).default('for_you'),
});

export const feedRoutes = new Hono<AppEnv>();

feedRoutes.get('/feed', async (c) => {
  const parsed = FeedQuery.safeParse(c.req.query());
  if (!parsed.success) throw badRequest('Invalid feed parameters');
  const q = parsed.data;
  const { store, ranker } = c.get('deps');
  const userId = c.get('user').id;

  const exclude = new Set((q.exclude ?? '').split(',').filter(Boolean));
  const [candidates, personalised, blocked] = await Promise.all([
    store.feedCandidates({ cityId: q.cityId, lat: q.lat, lng: q.lng, maxKm: 30, limit: 400 }),
    store.hasConsent(userId, 'personalisation'),
    store.blockedUserIds(userId),
  ]);
  let pool = candidates.filter((cand) => !exclude.has(cand.videoId) && !blocked.has(cand.uploaderId));

  let ranked: Awaited<ReturnType<typeof ranker.rank>>;
  if (q.mode === 'following') {
    // Following: newest videos from restaurants and creators the user follows. No personalised ranking,
    // but explicit dietary/allergen filters still apply.
    const [followed, prefs] = await Promise.all([store.followedIds(userId), store.getPreferences(userId)]);
    const avoid = new Set(prefs.avoidAllergens);
    pool = pool.filter((cand) => (cand.restaurantId && followed.restaurants.has(cand.restaurantId)) || (cand.source !== 'restaurant' && followed.creators.has(cand.uploaderId)))
      .filter((cand) => satisfiesDietary(cand, prefs.dietaryRequirements) && !(cand.itemAllergens ?? []).some((a) => avoid.has(a)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    ranked = { feedRequestId: crypto.randomUUID(), modelVersion: 'following-recency', items: pool.slice(0, q.limit).map((candidate) => ({ candidate, ranking: null })) };
  } else {
    ranked = await ranker.rank({ userId, personalised, candidates: pool, limit: q.limit, now: c.get('deps').now?.() ?? new Date() });
  }

  const ids = ranked.items.map((r) => r.candidate.videoId);
  const viewer = await store.viewerVideoState(userId, ids);
  const body: FeedResponse = {
    feedRequestId: ranked.feedRequestId,
    modelVersion: ranked.modelVersion,
    personalised: q.mode === 'for_you' && personalised,
    items: ranked.items.map((r) => toFeedItem(r.candidate, {
      liked: viewer.liked.has(r.candidate.videoId),
      saved: viewer.saved.has(r.candidate.videoId),
      craved: viewer.craved.has(r.candidate.videoId),
      followingCreator: viewer.followedCreators?.has(r.candidate.uploaderId) ?? false,
    }, r.ranking)),
  };
  return c.json(body);
});

feedRoutes.get('/saved', async (c) => {
  const collection = c.req.query('collection') === 'saved' ? 'saved' : 'cravings';
  const rows = await c.get('deps').store.listSaved(c.get('user').id, collection);
  return c.json({ collection, items: rows });
});

feedRoutes.put('/creators/:id/follow', async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'));
  const body = z.object({ follow: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success) throw badRequest('Invalid request');
  if (id.data === c.get('user').id) throw badRequest('You can’t follow yourself');
  await c.get('deps').store.setCreatorFollow(c.get('user').id, id.data, body.data.follow);
  return c.json({ following: body.data.follow });
});
