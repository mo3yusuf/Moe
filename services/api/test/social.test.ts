import { EMPTY_PREFERENCES } from '@crave/core';
import { describe, expect, it, vi } from 'vitest';
import { authed, candidate, makeApp } from './helpers';

const prefs = (over = {}) => ({ ...EMPTY_PREFERENCES, avoidAllergens: [] as string[], preferredFulfilment: null, ...over });
const viewer = async () => ({ liked: new Set<string>(), saved: new Set<string>(), craved: new Set<string>(), followedCreators: new Set(['creator-1']) });

describe('Following feed', () => {
  const followedRestaurant = candidate({ restaurantId: 'r-followed', publishedAt: '2026-11-01T00:00:00Z' });
  const followedCreator = candidate({ uploaderId: 'creator-1', restaurantId: 'r-x', publishedAt: '2026-11-02T00:00:00Z' });
  const stranger = candidate({ uploaderId: 'creator-2', restaurantId: 'r-y' });
  const peanuts = candidate({ restaurantId: 'r-followed', itemAllergens: ['peanut'], publishedAt: '2026-11-03T00:00:00Z' });
  const store = (avoid: string[] = []) => ({
    feedCandidates: async () => [followedRestaurant, followedCreator, stranger, peanuts],
    hasConsent: async () => true,
    blockedUserIds: async () => new Set<string>(),
    followedIds: async () => ({ restaurants: new Set(['r-followed']), creators: new Set(['creator-1']) }),
    getPreferences: async () => prefs({ avoidAllergens: avoid }),
    viewerVideoState: viewer,
  });

  it('shows only followed restaurants and creators, newest first, unpersonalised', async () => {
    const body = await (await makeApp(store()).request('/v1/feed?mode=following', authed('u'))).json() as any;
    expect(body.items.map((i: any) => i.videoId)).toEqual([peanuts.videoId, followedCreator.videoId, followedRestaurant.videoId]);
    expect(body.modelVersion).toBe('following-recency');
    expect(body.personalised).toBe(false);
    expect(body.items.find((i: any) => i.videoId === followedCreator.videoId).viewer.followingCreator).toBe(true);
  });

  it('still applies the avoid-allergens filter', async () => {
    const body = await (await makeApp(store(['peanut'])).request('/v1/feed?mode=following', authed('u'))).json() as any;
    expect(body.items.map((i: any) => i.videoId)).not.toContain(peanuts.videoId);
  });
});

describe('follows and preferences', () => {
  it('follows creators but not yourself', async () => {
    const setCreatorFollow = vi.fn(async () => {});
    const app = makeApp({ setCreatorFollow });
    const other = '22222222-2222-4222-8222-222222222222';
    expect((await app.request(`/v1/creators/${other}/follow`, authed('me', { method: 'PUT', body: JSON.stringify({ follow: true }) }))).status).toBe(200);
    expect(setCreatorFollow).toHaveBeenCalledWith('me', other, true);
    expect((await app.request(`/v1/creators/${other}/follow`, authed(other, { method: 'PUT', body: JSON.stringify({ follow: true }) }))).status).toBe(400);
  });

  it('saves avoid-allergens from the fixed vocabulary only', async () => {
    const setPreferences = vi.fn(async () => {});
    const app = makeApp({ setPreferences });
    expect((await app.request('/v1/preferences', authed('u', { method: 'PUT', body: JSON.stringify({ avoidAllergens: ['peanut', 'sesame'] }) }))).status).toBe(200);
    expect(setPreferences).toHaveBeenCalledWith('u', expect.objectContaining({ avoidAllergens: ['peanut', 'sesame'] }));
    expect((await app.request('/v1/preferences', authed('u', { method: 'PUT', body: JSON.stringify({ avoidAllergens: ['chocolate'] }) }))).status).toBe(400);
  });
});
