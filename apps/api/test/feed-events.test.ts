import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, db } from '../src/db';
import { buildFeed } from '../src/services/feed';
import { event, ids, sql, tokenFor, uuid } from './helpers';

const app = createApp();
const U = ids.users;
const V = ids.videos;
// Friday 6 Nov 2026, 19:00 Brisbane — every demo restaurant is open.
const FRIDAY_EVENING = new Date('2026-11-06T09:00:00Z');
const FORTITUDE_VALLEY = { lat: -27.457, lng: 153.035 };

async function get(path: string, userId?: string) {
  const headers: Record<string, string> = {};
  if (userId) headers.authorization = `Bearer ${await tokenFor(userId)}`;
  const res = await app.request(path, { headers });
  return { status: res.status, body: (await res.json()) as any };
}

async function post(path: string, body: unknown, userId?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userId) headers.authorization = `Bearer ${await tokenFor(userId)}`;
  const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

async function resetUser(userId: string) {
  await sql`delete from public.video_interactions where user_id = ${userId}`;
  await sql`delete from public.swipe_events where user_id = ${userId}`;
  await sql`delete from public.recommendation_impressions where user_id = ${userId}`;
  await sql`delete from public.user_taste_profiles where user_id = ${userId}`;
  await sql`delete from public.saved_meals where user_id = ${userId}`;
  await sql`delete from public.video_likes where user_id = ${userId}`;
  await sql`update public.profiles set personalisation_enabled = true where id = ${userId}`;
}

beforeEach(async () => {
  await resetUser(U.customer2!);
});

afterAll(async () => {
  await sql.end();
  await closeDb();
});

describe('GET /v1/feed', () => {
  it('works signed out, returning demo-labelled videos with real menu prices', async () => {
    const { status, body } = await get(`/v1/feed?session=${uuid()}&limit=30`);
    expect(status).toBe(200);
    expect(body.items.length).toBe(15);
    expect(body.items.every((i: any) => i.isDemo)).toBe(true);
    const smash = body.items.find((i: any) => i.videoId === V.v_smash_mia);
    expect(smash.meal).toMatchObject({ name: 'Double Smash Burger', priceCents: 1890, currency: 'AUD' });
    expect(smash.restaurant.name).toBe('Ember & Bun (DEMO)');
  });

  it('never exposes a dish from an unapproved tag or an unverified restaurant', async () => {
    const { items } = await buildFeed(db(), { userId: null, kind: 'for_you', sessionId: uuid(), location: null, limit: 30, now: FRIDAY_EVENING });
    const wontons = items.find((i) => i.videoId === V.v_wontons)!; // tag pending
    expect(wontons.meal).toBeNull();
    expect(wontons.orderable).toBe(false);
    const cookie = items.find((i) => i.videoId === V.v_cookie)!; // restaurant pending verification
    expect(cookie.restaurant).toBeNull();
    expect(cookie.orderable).toBe(false);
  });

  it('marks meals orderable only when the restaurant is open', async () => {
    const open = await buildFeed(db(), { userId: null, kind: 'for_you', sessionId: uuid(), location: null, limit: 30, now: FRIDAY_EVENING });
    expect(open.items.find((i) => i.videoId === V.v_aburi)!.orderable).toBe(true);
    // Monday 10:00 Brisbane: Kaizen (Tue–Sat) is closed and doesn't take advance orders.
    const monday = await buildFeed(db(), { userId: null, kind: 'for_you', sessionId: uuid(), location: null, limit: 30, now: new Date('2026-11-02T00:00:00Z') });
    const aburi = monday.items.find((i) => i.videoId === V.v_aburi)!;
    expect(aburi.orderable).toBe(false);
    expect(aburi.notOrderableReason).toMatch(/closed/);
    // Nonna Rosa accepts advance orders, so it stays orderable while closed.
    expect(monday.items.find((i) => i.videoId === V.v_marg)!.orderable).toBe(true);
  });

  it('nearby returns only orderable meals, closest first', async () => {
    const { items } = await buildFeed(db(), { userId: null, kind: 'nearby', sessionId: uuid(), location: FORTITUDE_VALLEY, limit: 30, now: FRIDAY_EVENING });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.orderable)).toBe(true);
    const d = items.map((i) => i.restaurant!.distanceKm!);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(items[0]!.restaurant!.name).toBe('Ember & Bun (DEMO)');
  });

  it('following feed only contains followed creators and restaurants', async () => {
    const { body } = await get(`/v1/feed?kind=following&session=${uuid()}&limit=30`, U.customer);
    const ok = body.items.every((i: any) => i.uploader.id === U.creator1 || i.restaurant?.id === ids.restaurants.kaizen);
    expect(body.items.length).toBeGreaterThan(0);
    expect(ok).toBe(true);
  });

  it('logs impressions and does not repeat videos within a session', async () => {
    const session = uuid();
    const page1 = await get(`/v1/feed?session=${session}&limit=5`, U.customer2);
    const page2 = await get(`/v1/feed?session=${session}&limit=5`, U.customer2);
    const a = page1.body.items.map((i: any) => i.videoId);
    const b = page2.body.items.map((i: any) => i.videoId);
    expect(a).toHaveLength(5);
    expect(b.filter((id: string) => a.includes(id))).toEqual([]);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.recommendation_impressions where user_id = ${U.customer2!} and feed_session_id = ${session}`;
    expect(n!.n).toBe(10);
  });

  it('signed-out paging uses the exclude list', async () => {
    const first = await get(`/v1/feed?session=${uuid()}&limit=5`);
    const exclude = first.body.items.map((i: any) => i.videoId).join(',');
    const second = await get(`/v1/feed?session=${uuid()}&limit=5&exclude=${exclude}`);
    expect(second.body.items.some((i: any) => exclude.includes(i.videoId))).toBe(false);
  });

  it('validates query parameters', async () => {
    expect((await get('/v1/feed?session=not-a-uuid')).status).toBe(400);
    expect((await get(`/v1/feed?session=${uuid()}&kind=bogus`)).status).toBe(400);
  });
});

describe('POST /v1/events — CRAVE Smart Swipe', () => {
  it('requires authentication and validates payloads', async () => {
    expect((await post('/v1/events', { events: [event('like', { videoId: V.v_aburi })] })).status).toBe(401);
    expect((await post('/v1/events', { events: [{ type: 'like' }] }, U.customer2)).status).toBe(400);
    expect((await post('/v1/events', { events: [] }, U.customer2)).status).toBe(400);
  });

  it('CRAVE IT saves the meal to Cravings, logs a right swipe and boosts the taste profile', async () => {
    const res = await post('/v1/events', { events: [event('crave_swipe', { videoId: V.v_aburi })] }, U.customer2);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: 1, learned: 1, personalisation: true });

    const saved = await sql`select source, menu_item_id from public.saved_meals where user_id = ${U.customer2!} and video_id = ${V.v_aburi!}`;
    expect(saved).toEqual([{ source: 'crave_swipe', menu_item_id: ids.items['kaizen:aburi'] }]);
    const swipes = await sql`select direction from public.swipe_events where user_id = ${U.customer2!}`;
    expect(swipes).toEqual([{ direction: 'right' }]);
    const profile = await get('/v1/me/taste-profile', U.customer2);
    expect(profile.body.summary.likedCuisines[0].key).toBe('japanese');
  });

  it('is idempotent: retrying the same clientEventId is not double counted', async () => {
    const e = event('crave_swipe', { videoId: V.v_shawarma });
    await post('/v1/events', { events: [e] }, U.customer2);
    const retry = await post('/v1/events', { events: [e] }, U.customer2);
    expect(retry.body).toMatchObject({ duplicates: 1, learned: 0 });
    const [p] = await sql<{ signal_count: number }[]>`select signal_count from public.user_taste_profiles where user_id = ${U.customer2!}`;
    expect(p!.signal_count).toBe(1);
  });

  it('NOT FOR ME removes that exact video from future feeds', async () => {
    await post('/v1/events', { events: [event('not_for_me_swipe', { videoId: V.v_prawns })] }, U.customer2);
    for (let i = 0; i < 2; i++) {
      const { body } = await get(`/v1/feed?session=${uuid()}&limit=30`, U.customer2);
      expect(body.items.map((x: any) => x.videoId)).not.toContain(V.v_prawns);
    }
    // ...but other seafood is still eligible (no category ban from one swipe).
    const { body } = await get(`/v1/feed?session=${uuid()}&limit=30`, U.customer2);
    expect(body.items.map((x: any) => x.videoId)).toContain(V.v_bugroll);
  });

  it('right swipes on sushi make Japanese meals rank first', async () => {
    const events = [V.v_aburi, V.v_chirashi].map((videoId) => event('crave_swipe', { videoId }));
    events.push(...[V.v_aburi, V.v_chirashi].map((videoId) => event('watch', { videoId, watchedMs: 15000, durationMs: 15000, loops: 1 })));
    await post('/v1/events', { events }, U.customer2);
    const { items } = await buildFeed(db(), { userId: U.customer2!, kind: 'for_you', sessionId: uuid(), location: null, limit: 3, now: FRIDAY_EVENING });
    expect(items[0]!.restaurant?.name).toBe('Kaizen Sushi Bar (DEMO)');
    expect(items[0]!.reasons.join(' ')).toMatch(/Japanese|restaurant you like/);
  });

  it('a quick skip is recorded as a weak signal, not a hide', async () => {
    const res = await post('/v1/events', { events: [event('watch', { videoId: V.v_bao, watchedMs: 600, durationMs: 15000, loops: 0 })] }, U.customer2);
    expect(res.body.learned).toBe(1);
    const [row] = await sql<{ watch_signal: string }[]>`select watch_signal from public.video_interactions where user_id = ${U.customer2!}`;
    expect(row!.watch_signal).toBe('quick_skip');
    const { body } = await get(`/v1/feed?session=${uuid()}&limit=30`, U.customer2);
    expect(body.items.map((x: any) => x.videoId)).toContain(V.v_bao);
  });

  it('with personalisation turned off, nothing is logged or learned but Cravings still saves', async () => {
    await sql`update public.profiles set personalisation_enabled = false where id = ${U.customer2!}`;
    const res = await post('/v1/events', { events: [event('crave_swipe', { videoId: V.v_marg }), event('watch', { videoId: V.v_marg, watchedMs: 9000, durationMs: 15000 })] }, U.customer2);
    expect(res.body).toMatchObject({ personalisation: false, learned: 0 });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.video_interactions where user_id = ${U.customer2!}`;
    expect(n!.n).toBe(0);
    const saved = await sql`select 1 from public.saved_meals where user_id = ${U.customer2!} and video_id = ${V.v_marg!}`;
    expect(saved).toHaveLength(1);
    const feed = await get(`/v1/feed?session=${uuid()}&limit=5`, U.customer2);
    const [imps] = await sql<{ n: number }[]>`select count(*)::int as n from public.recommendation_impressions where user_id = ${U.customer2!}`;
    expect(feed.status).toBe(200);
    expect(imps!.n).toBe(0);
  });

  it('ignores events for unpublished or unknown videos', async () => {
    const res = await post('/v1/events', { events: [event('like', { videoId: uuid() })] }, U.customer2);
    expect(res.body.accepted).toBe(0);
  });
});

describe('Reset My Taste Profile', () => {
  it('clears learned signals but keeps Cravings', async () => {
    await post('/v1/events', { events: [event('crave_swipe', { videoId: V.v_smash_mia }), event('not_for_me_swipe', { videoId: V.v_prawns })] }, U.customer2);
    const reset = await post('/v1/me/taste-profile/reset', {}, U.customer2);
    expect(reset.status).toBe(200);
    const profile = await get('/v1/me/taste-profile', U.customer2);
    expect(profile.body.summary).toMatchObject({ signalCount: 0, hiddenVideoCount: 0, likedCuisines: [] });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.video_interactions where user_id = ${U.customer2!}`;
    expect(n!.n).toBe(0);
    const saved = await sql`select 1 from public.saved_meals where user_id = ${U.customer2!}`;
    expect(saved).toHaveLength(1);
    const { body } = await get(`/v1/feed?session=${uuid()}&limit=30`, U.customer2);
    expect(body.items.map((x: any) => x.videoId)).toContain(V.v_prawns);
  });

  it('explains what data is and is not used', async () => {
    const { body } = await get('/v1/me/taste-profile', U.customer2);
    expect(body.dataUsed.length).toBeGreaterThan(3);
    expect(body.notUsed.join(' ')).toMatch(/precise location/);
  });
});
