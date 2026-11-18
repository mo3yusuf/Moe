import { describe, expect, it, vi } from 'vitest';
import { TtlCache, withReadCache } from '../src/lib/cache';
import type { DataStore } from '../src/lib/store';
import { authed, makeApp } from './helpers';

describe('TtlCache', () => {
  it('serves hits within the TTL, reloads after it, shares in-flight loads and never caches failures', async () => {
    let now = 0;
    const cache = new TtlCache<number>(1000, 10, () => now);
    const load = vi.fn(async () => 42);
    await Promise.all([cache.get('k', load), cache.get('k', load)]);
    expect(load).toHaveBeenCalledTimes(1);
    now = 999; await cache.get('k', load); expect(load).toHaveBeenCalledTimes(1);
    now = 1001; await cache.get('k', load); expect(load).toHaveBeenCalledTimes(2);
    const boom = vi.fn(async () => { throw new Error('db down'); });
    await expect(cache.get('x', boom)).rejects.toThrow('db down');
    await expect(cache.get('x', boom)).rejects.toThrow('db down');
    expect(boom).toHaveBeenCalledTimes(2);
  });
});

describe('withReadCache', () => {
  it('caches the shared feed pool on a ~1 km grid, menu items and search; leaves personal reads alone', async () => {
    const base = {
      feedCandidates: vi.fn(async () => []),
      menuItemDetail: vi.fn(async () => null),
      nearbyRestaurants: vi.fn(async () => []),
      viewerVideoState: vi.fn(async () => ({ liked: new Set(), saved: new Set(), craved: new Set() })),
    } as unknown as DataStore;
    const s = withReadCache(base);
    await s.feedCandidates({ lat: -27.4701, lng: 153.0210, maxKm: 30, limit: 400 });
    await s.feedCandidates({ lat: -27.4704, lng: 153.0213, maxKm: 30, limit: 400 }); // same ~1 km cell
    await s.feedCandidates({ lat: -27.5000, lng: 153.0210, maxKm: 30, limit: 400 }); // different cell
    expect(base.feedCandidates).toHaveBeenCalledTimes(2);
    await s.menuItemDetail('a'); await s.menuItemDetail('a');
    expect(base.menuItemDetail).toHaveBeenCalledTimes(1);
    await s.nearbyRestaurants({ maxKm: 15, query: 'Ramen', limit: 20 }); await s.nearbyRestaurants({ maxKm: 15, query: ' ramen', limit: 20 });
    expect(base.nearbyRestaurants).toHaveBeenCalledTimes(1);
    await s.viewerVideoState('u', []); await s.viewerVideoState('u', []);
    expect(base.viewerVideoState).toHaveBeenCalledTimes(2);
  });
});

describe('health endpoints', () => {
  it('/health is cheap; /health/ready checks the database', async () => {
    expect((await makeApp({}).request('/health')).status).toBe(200);
    const ok = await makeApp({}, { healthCheck: async () => true }).request('/health/ready');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, database: 'ok' });
    const down = await makeApp({}, { healthCheck: async () => false }).request('/health/ready');
    expect(down.status).toBe(503);
  });
});

describe('crash reporting', () => {
  it('unexpected errors are reported (e.g. to Sentry) and clients get a generic 500', async () => {
    const reported: unknown[] = [];
    const app = makeApp({ menuItemDetail: async () => { throw new Error('db exploded'); } }, { reportError: (e) => reported.push(e) });
    const res = await app.request('/v1/menu-items/00000000-0000-4000-8000-000000000001', authed('u1'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('exploded');
    expect(reported).toHaveLength(1);
  });
});
