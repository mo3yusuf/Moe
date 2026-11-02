import { describe, expect, it } from 'vitest';
import type { FeedCandidate } from '../src/feed-types';
import { checkDeliveryEligibility } from '../src/delivery';
import { quoteBasket } from '../src/pricing';
import {
  candidateFeatures, collaborativeScores, DEFAULT_RANKING_CONFIG, EMPTY_PREFERENCES, emptyProfile, holdoutEvaluate,
  mergeRankingConfig, rankFeed, seededRandom, type Signal,
} from '../src/recommend';

const NOW = new Date('2026-11-06T09:00:00Z');
function cand(i: number, cuisine: string): FeedCandidate {
  return {
    videoId: `v${i}`, playbackUrl: 'x', thumbnailUrl: null, durationMs: 15000, caption: null, hashtags: [], isSponsored: false, sponsorDisclosure: null,
    publishedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(), source: 'creator', uploaderId: `c${i % 7}`, creatorHandle: null, creatorDisplayName: null,
    restaurantId: `r${i}`, restaurantName: `R${i}`, restaurantSlug: null, cuisines: [cuisine], priceLevel: 2, halalCertified: false, locationId: 'l',
    suburb: null, distanceKm: 2, isOpen: true, acceptingOrders: true, pickupEnabled: true, menuItemId: `m${i}`, menuItemName: `Dish ${i}`,
    priceCents: 1800, currency: 'AUD', itemCuisine: cuisine, itemCategory: `cat${i % 9}`, itemTags: [], dietaryTags: [], spiceLevel: 0,
    itemAvailable: true, orderable: true, stats: { likes: 0, comments: 0, impressions: 0, completions: 0, rightSwipes: 0, leftSwipes: 0, orders: 0 },
  };
}

describe('collaborative scores', () => {
  it('takes the strongest similarity to anything the user liked, excluding already-liked videos', () => {
    const s = collaborativeScores(['a', 'b'], [
      { videoId: 'a', similarVideoId: 'x', score: 0.4 }, { videoId: 'b', similarVideoId: 'x', score: 0.7 },
      { videoId: 'a', similarVideoId: 'b', score: 0.9 }, { videoId: 'z', similarVideoId: 'y', score: 1 },
    ]);
    expect([...s.entries()]).toEqual([['x', 0.7]]);
  });

  it('boosts similar videos and explains why', () => {
    const cands = [cand(1, 'thai'), cand(2, 'thai'), cand(3, 'thai')];
    const ranked = rankFeed({ candidates: cands, profile: emptyProfile(), preferences: EMPTY_PREFERENCES, personalised: true, now: NOW, limit: 3,
      collaborative: new Map([['v3', 0.8]]), random: seededRandom(1) });
    expect(ranked[0]!.candidate.videoId).toBe('v3');
    expect(ranked[0]!.reasons).toContain('Loved by people with your taste');
  });
});

describe('offline hold-out evaluation', () => {
  // Two latent taste groups whose favourite videos span many cuisines, so content features alone
  // can't separate them — the case where collaborative filtering should help.
  const cuisines = ['thai', 'italian', 'japanese', 'mexican', 'chinese', 'american'];
  const catalogue = Array.from({ length: 60 }, (_, i) => cand(i, cuisines[i % cuisines.length]!));
  const groupA = catalogue.filter((_, i) => i % 2 === 0).slice(0, 12);
  const groupB = catalogue.filter((_, i) => i % 2 === 1).slice(0, 12);
  const rnd = seededRandom(7);
  const sims: { videoId: string; similarVideoId: string; score: number }[] = [];
  for (const g of [groupA, groupB]) for (const a of g) for (const b of g) if (a !== b) sims.push({ videoId: a.videoId, similarVideoId: b.videoId, score: 0.6 });
  const users = Array.from({ length: 40 }, (_, u) => {
    const group = u % 2 ? groupB : groupA;
    const picks = [...group].sort(() => rnd() - 0.5).slice(0, 4);
    const signals: Signal[] = picks.map((c, i) => ({ kind: 'right_swipe', at: new Date(NOW.getTime() - (10 - i) * 3600_000), videoId: c.videoId, menuItemId: c.menuItemId, item: candidateFeatures(c) }));
    return { signals };
  });

  it('measures hit rate and MRR, and shows collaborative filtering helping on this population', () => {
    const [base, cf] = holdoutEvaluate(users, catalogue, [
      { name: 'content-only', config: DEFAULT_RANKING_CONFIG, useCollaborative: false },
      { name: 'with-cf', config: DEFAULT_RANKING_CONFIG, useCollaborative: true },
    ], { k: 10, similarities: sims, now: NOW });
    expect(base!.users).toBe(40);
    expect(cf!.hitRateAtK).toBeGreaterThan(base!.hitRateAtK + 0.3);
    expect(cf!.mrr).toBeGreaterThan(base!.mrr);
  });

  it('a zero collaborative weight behaves like content-only', () => {
    const off = mergeRankingConfig({ score: { collaborative: 0 } }).config;
    const [a, b] = holdoutEvaluate(users, catalogue, [
      { name: 'a', config: off, useCollaborative: true }, { name: 'b', config: off, useCollaborative: false },
    ], { similarities: sims, now: NOW });
    expect(a!.hitRateAtK).toBeCloseTo(b!.hitRateAtK);
  });
});

describe('delivery', () => {
  const loc = { deliveryEnabled: true, deliveryRadiusKm: 5, lat: -27.4575, lng: 153.0355, deliveryMinOrderCents: 2000 };
  it('checks radius and minimum order', () => {
    expect(checkDeliveryEligibility(loc, { lat: -27.467, lng: 153.045 }, 2500)).toMatchObject({ ok: true });
    expect(checkDeliveryEligibility(loc, { lat: -27.58, lng: 153.06 }, 2500)).toMatchObject({ ok: false, reason: 'out_of_range' });
    expect(checkDeliveryEligibility(loc, { lat: -27.467, lng: 153.045 }, 1500)).toMatchObject({ ok: false, reason: 'below_minimum' });
    expect(checkDeliveryEligibility({ ...loc, deliveryEnabled: false }, { lat: -27.46, lng: 153.04 }, 5000)).toMatchObject({ ok: false, reason: 'delivery_disabled' });
  });
  it('adds the delivery fee to the total with GST, without changing commission or restaurant net', () => {
    const item = { id: 'i', name: 'x', priceCents: 2200, isAvailable: true, gstApplicable: true, optionGroups: [] };
    const pickup = quoteBasket([{ item, optionIds: [], quantity: 1 }], { commissionRateBps: 1000 });
    const delivered = quoteBasket([{ item, optionIds: [], quantity: 1 }], { commissionRateBps: 1000, deliveryFeeCents: 699 });
    expect(delivered.totalCents).toBe(pickup.totalCents + 699);
    expect(delivered.gstCents).toBe(pickup.gstCents + Math.round(699 / 11));
    expect(delivered.commissionCents).toBe(pickup.commissionCents);
    expect(delivered.restaurantNetCents).toBe(pickup.restaurantNetCents);
  });
});

describe('collaborative privacy', () => {
  it('is ignored without personalisation consent', () => {
    const cands = [cand(1, 'thai'), cand(2, 'thai'), cand(3, 'thai')];
    const ranked = rankFeed({ candidates: cands, profile: emptyProfile(), preferences: EMPTY_PREFERENCES, personalised: false, now: NOW, limit: 3,
      collaborative: new Map([['v3', 1]]), random: seededRandom(1) });
    expect(ranked.every((r) => r.parts.collaborative === undefined)).toBe(true);
  });
});
