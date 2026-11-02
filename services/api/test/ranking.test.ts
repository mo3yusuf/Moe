import { candidateFeatures, EMPTY_PREFERENCES, seededRandom, type Signal } from '@crave/core';
import { describe, expect, it, vi } from 'vitest';
import { rulesRanker } from '../src/lib/ranker';
import type { DataStore, RankingContext } from '../src/lib/store';
import { authed, candidate, makeApp } from './helpers';

const NOW = new Date('2026-11-06T09:00:00Z');
const sushi = candidate({ itemCuisine: 'japanese', itemCategory: 'sushi', restaurantId: 'r-sushi', menuItemName: 'Nigiri' });
const sushi2 = candidate({ itemCuisine: 'japanese', itemCategory: 'sushi', restaurantId: 'r-sushi2', menuItemName: 'Roll' });
const burger = candidate({ itemCuisine: 'american', itemCategory: 'burger', restaurantId: 'r-burger', menuItemName: 'Burger' });
const tacos = candidate({ itemCuisine: 'mexican', itemCategory: 'tacos', restaurantId: 'r-taco', menuItemName: 'Tacos' });

function ctxWith(signals: Signal[]): RankingContext {
  return { signals, impressions: [], resetAt: null, preferences: EMPTY_PREFERENCES, weights: null };
}
const swipe = (kind: Signal['kind'], c = sushi): Signal => ({ kind, at: new Date(NOW.getTime() - 86_400_000), videoId: c.videoId, menuItemId: c.menuItemId, item: candidateFeatures(c) });

describe('rulesRanker', () => {
  it('personalises from stored signals and logs impressions', async () => {
    const recordImpressions = vi.fn(async () => {});
    const store = { loadRankingContext: async () => ctxWith([swipe('right_swipe'), swipe('right_swipe', sushi2)]), recordImpressions } as unknown as DataStore;
    const res = await rulesRanker(store, { random: seededRandom(1) }).rank({ userId: 'u', personalised: true, candidates: [burger, tacos, sushi, sushi2], limit: 4, now: NOW });
    expect(res.modelVersion).toBe('rules-v1');
    const top = res.items[0]!.candidate;
    expect(top.itemCuisine).toBe('japanese');
    expect(recordImpressions).toHaveBeenCalledOnce();
    expect((recordImpressions.mock.calls[0] as unknown[])[1]).toBe(res.feedRequestId);
  });

  it('does not log impressions or use history without consent', async () => {
    const recordImpressions = vi.fn(async () => {});
    const loadRankingContext = vi.fn(async () => ctxWith([]));
    const store = { loadRankingContext, recordImpressions } as unknown as DataStore;
    await rulesRanker(store).rank({ userId: 'u', personalised: false, candidates: [burger, sushi], limit: 2, now: NOW });
    expect(recordImpressions).not.toHaveBeenCalled();
    expect(loadRankingContext).toHaveBeenCalledWith('u', expect.objectContaining({ personalised: false }));
  });

  it('hides a left-swiped video and applies admin weight overrides', async () => {
    const store = {
      loadRankingContext: async () => ({ ...ctxWith([swipe('left_swipe', tacos)]), weights: { modelVersion: 'rules-v1-test' } }),
      recordImpressions: async () => {},
    } as unknown as DataStore;
    const res = await rulesRanker(store).rank({ userId: 'u', personalised: true, candidates: [burger, tacos, sushi], limit: 5, now: NOW });
    expect(res.items.map((i) => i.candidate.videoId)).not.toContain(tacos.videoId);
    expect(res.modelVersion).toBe('rules-v1-test');
  });

  it('a failing impression log never breaks the feed', async () => {
    const onError = vi.fn();
    const store = { loadRankingContext: async () => ctxWith([]), recordImpressions: async () => { throw new Error('db down'); } } as unknown as DataStore;
    const res = await rulesRanker(store, { onError }).rank({ userId: 'u', personalised: true, candidates: [burger], limit: 1, now: NOW });
    expect(res.items).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });
});

describe('preferences and taste profile endpoints', () => {
  it('validates and saves explicit preferences', async () => {
    const setPreferences = vi.fn(async () => {});
    const app = makeApp({ setPreferences });
    const ok = await app.request('/v1/preferences', authed('u', { method: 'PUT', body: JSON.stringify({ favouriteCuisines: ['Japanese'], dietaryRequirements: ['halal'], spicePreference: 2 }) }));
    expect(ok.status).toBe(200);
    expect(setPreferences).toHaveBeenCalledWith('u', expect.objectContaining({ favouriteCuisines: ['japanese'], dietaryRequirements: ['halal'] }));

    for (const bad of [{ dietaryRequirements: ['keto'] }, { favouriteCuisines: ['thai'], dislikedCuisines: ['thai'] }, { spicePreference: 9 }, { favouriteCuisines: ['<script>'] }]) {
      const res = await app.request('/v1/preferences', authed('u', { method: 'PUT', body: JSON.stringify(bad) }));
      expect(res.status).toBe(400);
    }
  });

  it('explains the learned taste profile without exposing restaurant/creator ids as tastes', async () => {
    const app = makeApp({
      hasConsent: async () => true,
      loadRankingContext: async () => ctxWith([swipe('right_swipe'), swipe('right_swipe', sushi2), swipe('left_swipe', tacos)]),
    }, { now: () => NOW });
    const res = await app.request('/v1/taste-profile', authed('u'));
    const body = await res.json() as any;
    expect(body.personalised).toBe(true);
    expect(body.likes.map((l: any) => `${l.type}:${l.value}`)).toContain('cuisine:japanese');
    expect(body.dislikes.map((l: any) => `${l.type}:${l.value}`)).toContain('cuisine:mexican');
    expect(JSON.stringify(body)).not.toMatch(/restaurant:|creator:/);
  });
});
