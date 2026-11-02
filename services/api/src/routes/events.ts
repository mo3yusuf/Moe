import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { badRequest } from '../lib/errors';
import { EventBatch, planEventWrites } from '../lib/events';

export const eventRoutes = new Hono<AppEnv>();

/** Batched recommendation and engagement events from the app. Idempotent by clientEventId. */
eventRoutes.post('/events', async (c) => {
  const parsed = EventBatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid event batch');
  const { store } = c.get('deps');
  const userId = c.get('user').id;
  const personalisation = await store.hasConsent(userId, 'personalisation');
  const swipedVideos = [...new Set(parsed.data.events.flatMap((e) => (e.payload.kind === 'swipe' ? [e.payload.videoId] : [])))];
  const previousSwipes = personalisation && swipedVideos.length ? await store.latestSwipes(userId, swipedVideos) : undefined;
  const plan = planEventWrites(parsed.data.events, { personalisation, now: c.get('deps').now?.() ?? new Date(), previousSwipes });
  await store.applyEventPlan(userId, plan);
  return c.json({ accepted: parsed.data.events.length, personalisation });
});
