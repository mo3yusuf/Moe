import { describe, expect, it } from 'vitest';
import { planEventWrites, type IncomingEvent } from '../src/lib/events';
import { authed, makeApp } from './helpers';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-02T10:00:00Z');
let k = 0;
const ev = (payload: IncomingEvent['payload'], at = '2026-11-02T09:59:00Z'): IncomingEvent => ({
  clientEventId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++k).padStart(12, '0')}`, occurredAt: at, payload,
});

describe('planEventWrites', () => {
  it('stores behavioural signals only with personalisation consent', () => {
    const events = [
      ev({ kind: 'interaction', eventType: 'impression', videoId: V1 }),
      ev({ kind: 'interaction', eventType: 'watch', videoId: V1, watchMs: 12000, completionPct: 97 }),
      ev({ kind: 'swipe', videoId: V1, direction: 'right', inputMethod: 'gesture' }),
    ];
    const withConsent = planEventWrites(events, { personalisation: true, now: NOW });
    expect(withConsent.interactions).toHaveLength(2);
    expect(withConsent.swipes).toHaveLength(1);

    const without = planEventWrites(events, { personalisation: false, now: NOW });
    expect(without.interactions).toHaveLength(0);
    expect(without.swipes).toHaveLength(0);
    // Explicit feature still honoured, aggregate counters still updated.
    expect(without.cravingsAdd).toEqual([{ videoId: V1, menuItemId: null }]);
    expect(without.stats.get(V1)).toMatchObject({ impressions: 1, views3s: 1, completions: 1, rightSwipes: 1 });
  });

  it('latest swipe wins for Cravings; a change of mind moves the counters', () => {
    const plan = planEventWrites([
      ev({ kind: 'swipe', videoId: V1, direction: 'right', inputMethod: 'gesture' }, '2026-11-02T09:00:00Z'),
      ev({ kind: 'swipe', videoId: V1, direction: 'left', inputMethod: 'button' }, '2026-11-02T09:01:00Z'),
      ev({ kind: 'swipe', videoId: V2, direction: 'right', inputMethod: 'gesture' }),
    ], { personalisation: true, now: NOW });
    expect(plan.cravingsRemove).toEqual([V1]);
    expect(plan.cravingsAdd.map((c) => c.videoId)).toEqual([V2]);
    expect(plan.stats.get(V1)).toMatchObject({ rightSwipes: 0, leftSwipes: 1 });
  });

  it('uses the previous stored swipe to avoid double counting across batches', () => {
    const plan = planEventWrites([ev({ kind: 'swipe', videoId: V1, direction: 'left', inputMethod: 'gesture' })],
      { personalisation: true, now: NOW, previousSwipes: new Map([[V1, 'right']]) });
    expect(plan.stats.get(V1)).toMatchObject({ rightSwipes: -1, leftSwipes: 1 });
  });

  it('clamps future or stale client timestamps to server time', () => {
    const plan = planEventWrites([
      ev({ kind: 'interaction', eventType: 'impression', videoId: V1 }, '2030-01-01T00:00:00Z'),
      ev({ kind: 'interaction', eventType: 'impression', videoId: V2 }, '2020-01-01T00:00:00Z'),
    ], { personalisation: true, now: NOW });
    expect(plan.interactions.every((i) => i.createdAt === NOW.toISOString())).toBe(true);
  });

  it('like then unlike in one batch nets out', () => {
    const plan = planEventWrites([
      ev({ kind: 'action', action: 'like', videoId: V1 }),
      ev({ kind: 'action', action: 'unlike', videoId: V1 }),
    ], { personalisation: false, now: NOW });
    expect(plan.likesAdd).toEqual([]);
    expect(plan.likesRemove).toEqual([V1]);
  });
});

describe('POST /v1/events', () => {
  it('validates input and applies the plan for the authenticated user only', async () => {
    const applied: { userId: string; swipes: number }[] = [];
    const app = makeApp({
      hasConsent: async () => true,
      latestSwipes: async () => new Map(),
      applyEventPlan: async (userId, plan) => { applied.push({ userId, swipes: plan.swipes.length }); },
    });
    const res = await app.request('/v1/events', authed('user-a', {
      method: 'POST',
      body: JSON.stringify({ events: [ev({ kind: 'swipe', videoId: V1, direction: 'right', inputMethod: 'gesture' })] }),
    }));
    expect(res.status).toBe(200);
    expect(applied).toEqual([{ userId: 'user-a', swipes: 1 }]);
  });

  it('rejects malformed batches', async () => {
    const app = makeApp({ hasConsent: async () => true });
    for (const body of [{}, { events: [] }, { events: [{ clientEventId: 'x', occurredAt: 'now', payload: { kind: 'swipe' } }] }]) {
      const res = await app.request('/v1/events', authed('u', { method: 'POST', body: JSON.stringify(body) }));
      expect(res.status).toBe(400);
    }
  });

  it('rejects oversized batches', async () => {
    const app = makeApp({ hasConsent: async () => true });
    const events = Array.from({ length: 101 }, () => ev({ kind: 'interaction', eventType: 'impression', videoId: V1 }));
    const res = await app.request('/v1/events', authed('u', { method: 'POST', body: JSON.stringify({ events }) }));
    expect(res.status).toBe(400);
  });
});
