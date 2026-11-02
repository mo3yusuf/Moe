import { describe, expect, it } from 'vitest';
import { authed, candidate, makeApp } from './helpers';

describe('GET /v1/feed', () => {
  const a = candidate({ menuItemName: 'Smash', orderable: true });
  const b = candidate({ menuItemName: 'Closed one', orderable: false, isOpen: false });
  const c = candidate({ menuItemId: null, menuItemName: null, priceCents: null, orderable: false });
  const store = {
    feedCandidates: async () => [a, b, c],
    hasConsent: async () => true,
    viewerVideoState: async () => ({ liked: new Set([a.videoId]), saved: new Set<string>(), craved: new Set([a.videoId]) }),
  };

  it('returns feed items with server-computed orderability and viewer state', async () => {
    const res = await makeApp(store).request('/v1/feed?lat=-27.47&lng=153.02', authed('u1'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.feedRequestId).toMatch(/[0-9a-f-]{36}/);
    const byName = Object.fromEntries(body.items.map((i: any) => [i.menuItem?.name ?? 'none', i]));
    expect(byName['Smash']).toMatchObject({ orderable: true, notOrderableReason: null, viewer: { liked: true, craved: true } });
    expect(byName['Smash'].menuItem.priceCents).toBe(1690);
    expect(byName['Smash'].restaurant.distanceKm).toBe(2.3);
    expect(byName['Closed one']).toMatchObject({ orderable: false, notOrderableReason: 'restaurant_closed' });
    expect(byName['none']).toMatchObject({ orderable: false, notOrderableReason: 'no_linked_item', menuItem: null });
  });

  it('excludes videos already shown this session', async () => {
    const res = await makeApp(store).request(`/v1/feed?exclude=${a.videoId},${b.videoId}`, authed('u1'));
    const body = await res.json() as any;
    expect(body.items.map((i: any) => i.videoId)).toEqual([c.videoId]);
  });

  it('validates coordinates', async () => {
    const res = await makeApp(store).request('/v1/feed?lat=999', authed('u1'));
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    expect((await makeApp(store).request('/v1/feed')).status).toBe(401);
  });
});
