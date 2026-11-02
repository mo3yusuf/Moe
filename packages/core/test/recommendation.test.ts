import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOMMENDATION_CONFIG as CONFIG,
  EMPTY_PREFERENCES,
  applySignal,
  decayedScore,
  emptyTasteProfile,
  parseRecommendationConfig,
  rankFeed,
  scoreCandidate,
  type ExplicitPreferences,
  type FeedCandidate,
  type RankingContext,
  type TasteProfile,
} from '../src';

const NOW = new Date('2026-11-06T08:30:00Z'); // Friday 18:30 Brisbane
const TZ = 'Australia/Brisbane';

let n = 0;
function meal(partial: Partial<FeedCandidate> & { cuisines: string[] }): FeedCandidate {
  n += 1;
  return {
    videoId: `v${n}`,
    menuItemId: `m${n}`,
    restaurantId: `r${n}`,
    creatorId: null,
    category: 'mains',
    tags: [],
    priceCents: 2200,
    distanceKm: 3,
    orderable: true,
    publishedAt: '2026-11-01T00:00:00Z',
    trendingScore: 0.3,
    verifiedDietary: [],
    spiceLevel: null,
    isSponsored: false,
    ...partial,
  };
}

function ctx(overrides: Partial<RankingContext> = {}): RankingContext {
  return {
    now: NOW,
    timeZone: TZ,
    followedRestaurantIds: new Set(),
    followedCreatorIds: new Set(),
    impressionCounts: new Map(),
    seed: 42,
    ...overrides,
  };
}

const sig = { at: NOW, timeZone: TZ };

function train(profile: TasteProfile, signal: Parameters<typeof applySignal>[1], m: FeedCandidate, times = 1, at = NOW): TasteProfile {
  let p = profile;
  for (let i = 0; i < times; i++) p = applySignal(p, signal, m, { at, timeZone: TZ, fulfilment: 'pickup' }, CONFIG);
  return p;
}

describe('config', () => {
  it('validates the default config and rejects bad values', () => {
    expect(parseRecommendationConfig(CONFIG)).toEqual(CONFIG);
    expect(() => parseRecommendationConfig({ ...CONFIG, explorationRate: 0.9 })).toThrow();
  });
});

describe('taste profile learning', () => {
  it('a right swipe increases item, restaurant and cuisine affinity', () => {
    const sushi = meal({ cuisines: ['Japanese'], tags: ['sushi', 'salmon'] });
    const p = applySignal(emptyTasteProfile(), 'crave_swipe', sushi, sig, CONFIG);
    expect(p.affinities.item[sushi.menuItemId!]!.score).toBe(5);
    expect(p.affinities.restaurant[sushi.restaurantId!]!.score).toBeCloseTo(3);
    expect(p.affinities.cuisine.japanese!.score).toBeCloseTo(2.5);
    expect(p.signalCount).toBe(1);
  });

  it('a single left swipe hides the video but only slightly lowers the cuisine', () => {
    const prawns = meal({ cuisines: ['Seafood'], tags: ['prawns'] });
    const p = applySignal(emptyTasteProfile(), 'not_for_me_swipe', prawns, sig, CONFIG);
    expect(p.hiddenVideoIds).toContain(prawns.videoId);
    expect(p.affinities.cuisine.seafood!.score).toBeCloseTo(-0.48);
    expect(p.affinities.item[prawns.menuItemId!]!.score).toBe(-4);
  });

  it('repeated rejection of a cuisine is floored, never fully excluded', () => {
    let p = emptyTasteProfile();
    for (let i = 0; i < 50; i++) p = applySignal(p, 'not_for_me_swipe', meal({ cuisines: ['Seafood'] }), sig, CONFIG);
    expect(p.affinities.cuisine.seafood!.score).toBe(CONFIG.broadDimensionFloor);
    // A different, unseen seafood dish still appears in the feed (just lower).
    const fresh = meal({ cuisines: ['Seafood'] });
    const ranked = rankFeed([fresh, meal({ cuisines: ['Italian'] })], p, EMPTY_PREFERENCES, ctx(), CONFIG);
    expect(ranked.map((r) => r.candidate.videoId)).toContain(fresh.videoId);
  });

  it('orders are stronger than passive viewing, and repeat orders are stronger still', () => {
    const burger = meal({ cuisines: ['American'] });
    const viewed = applySignal(emptyTasteProfile(), 'long_view', burger, sig, CONFIG);
    const ordered = applySignal(emptyTasteProfile(), 'order_completed', burger, sig, CONFIG);
    const reordered = applySignal(ordered, 'order_completed', burger, sig, CONFIG);
    const item = burger.menuItemId!;
    expect(ordered.affinities.item[item]!.score).toBeGreaterThan(viewed.affinities.item[item]!.score);
    expect(reordered.affinities.item[item]!.score - ordered.affinities.item[item]!.score).toBe(CONFIG.signalWeights.repeat_order);
    expect(ordered.orderedItemIds).toEqual([item]);
    expect(ordered.avgOrderItemCents).toBe(2200);
    expect(ordered.fulfilmentCounts.pickup).toBe(0); // fulfilment only counted when provided
  });

  it('quick skips are weak negatives, much weaker than an explicit left swipe', () => {
    const m = meal({ cuisines: ['Thai'] });
    const skipped = applySignal(emptyTasteProfile(), 'quick_skip', m, sig, CONFIG);
    const rejected = applySignal(emptyTasteProfile(), 'not_for_me_swipe', m, sig, CONFIG);
    expect(skipped.hiddenVideoIds).toEqual([]);
    expect(Math.abs(skipped.affinities.item[m.menuItemId!]!.score)).toBeLessThan(Math.abs(rejected.affinities.item[m.menuItemId!]!.score) / 5);
  });

  it('affinities decay over time', () => {
    const entry = { score: 10, updatedAt: '2026-01-01T00:00:00Z' };
    const later = new Date(new Date(entry.updatedAt).getTime() + CONFIG.affinityHalfLifeDays * 86_400_000);
    expect(decayedScore(entry, later, CONFIG.affinityHalfLifeDays)).toBeCloseTo(5);
  });

  it('learns ordering habits by weekday and daypart', () => {
    const sushi = meal({ cuisines: ['Japanese'] });
    const p = applySignal(emptyTasteProfile(), 'order_completed', sushi, sig, CONFIG);
    expect(p.orderTimes['japanese@5:dinner']).toBe(1); // Friday dinner
  });
});

describe('feed ranking', () => {
  it('cold start: with no history, nearby trending orderable meals rank first', () => {
    const near = meal({ cuisines: ['Thai'], distanceKm: 0.8, trendingScore: 0.9 });
    const far = meal({ cuisines: ['Thai'], distanceKm: 18, trendingScore: 0.1 });
    const closed = meal({ cuisines: ['Thai'], distanceKm: 0.8, trendingScore: 0.9, orderable: false });
    const ranked = rankFeed([far, closed, near], emptyTasteProfile(), EMPTY_PREFERENCES, ctx({ seed: 1 }), { ...CONFIG, explorationRate: 0 });
    expect(ranked[0]!.candidate.videoId).toBe(near.videoId);
    expect(ranked.at(-1)!.candidate.videoId).toBe(far.videoId);
  });

  it('cold start uses onboarding cuisine preferences', () => {
    const thai = meal({ cuisines: ['Thai'] });
    const italian = meal({ cuisines: ['Italian'] });
    const prefs: ExplicitPreferences = { ...EMPTY_PREFERENCES, favouriteCuisines: ['italian'] };
    const ranked = rankFeed([thai, italian], emptyTasteProfile(), prefs, ctx(), { ...CONFIG, explorationRate: 0 });
    expect(ranked[0]!.candidate.videoId).toBe(italian.videoId);
    expect(ranked[0]!.reasons).toContain('Matches your food preferences');
  });

  it('right swipes gradually surface related meals', () => {
    const craved = meal({ cuisines: ['Japanese'], tags: ['sushi'] });
    const relatedSushi = meal({ cuisines: ['Japanese'], tags: ['sushi'] });
    const pizza = meal({ cuisines: ['Italian'], tags: ['pizza'], trendingScore: 0.6 });
    const profile = train(emptyTasteProfile(), 'crave_swipe', craved, 4);
    const ranked = rankFeed([pizza, relatedSushi], profile, EMPTY_PREFERENCES, ctx(), { ...CONFIG, explorationRate: 0 });
    expect(ranked[0]!.candidate.videoId).toBe(relatedSushi.videoId);
    expect(ranked[0]!.reasons).toContain('Because you crave Japanese');
  });

  it('consistent seafood rejection reduces similar recommendations', () => {
    let profile = emptyTasteProfile();
    for (let i = 0; i < 10; i++) profile = train(profile, 'not_for_me_swipe', meal({ cuisines: ['Seafood'], tags: ['prawns'] }));
    const seafood = meal({ cuisines: ['Seafood'], tags: ['prawns'] });
    const burger = meal({ cuisines: ['American'], tags: ['burger'] });
    const ranked = rankFeed([seafood, burger], profile, EMPTY_PREFERENCES, ctx(), { ...CONFIG, explorationRate: 0 });
    expect(ranked[0]!.candidate.videoId).toBe(burger.videoId);
  });

  it('never shows a video the customer said NOT FOR ME', () => {
    const m = meal({ cuisines: ['Thai'] });
    const profile = train(emptyTasteProfile(), 'not_for_me_swipe', m);
    expect(rankFeed([m], profile, EMPTY_PREFERENCES, ctx(), CONFIG)).toEqual([]);
  });

  it('frequent halal burger orders boost verified halal burger options', () => {
    let profile = emptyTasteProfile();
    for (let i = 0; i < 5; i++) {
      profile = train(profile, 'order_completed', meal({ cuisines: ['American'], tags: ['burger', 'halal'], verifiedDietary: ['halal_certified'] }));
    }
    const halalBurger = meal({ cuisines: ['American'], tags: ['burger', 'halal'], verifiedDietary: ['halal_certified'] });
    const ramen = meal({ cuisines: ['Japanese'], tags: ['ramen'], trendingScore: 0.8 });
    const ranked = rankFeed([ramen, halalBurger], profile, EMPTY_PREFERENCES, ctx(), { ...CONFIG, explorationRate: 0 });
    expect(ranked[0]!.candidate.videoId).toBe(halalBurger.videoId);
  });

  it('explicit dietary requirements are hard filters (never inferred)', () => {
    const halal = meal({ cuisines: ['Lebanese'], verifiedDietary: ['halal_certified'] });
    const notHalal = meal({ cuisines: ['Lebanese'], verifiedDietary: [] });
    const prefs = { ...EMPTY_PREFERENCES, dietaryRequirements: ['halal_certified'] };
    const ranked = rankFeed([halal, notHalal], emptyTasteProfile(), prefs, ctx(), CONFIG);
    expect(ranked.map((r) => r.candidate.videoId)).toEqual([halal.videoId]);
    // Behaviour alone never creates a requirement:
    const profile = train(emptyTasteProfile(), 'order_completed', halal, 10);
    expect(rankFeed([halal, notHalal], profile, EMPTY_PREFERENCES, ctx(), CONFIG)).toHaveLength(2);
  });

  it('respects avoided ingredients, spice limits and the service radius', () => {
    const peanut = meal({ cuisines: ['Thai'], tags: ['peanut'] });
    const hot = meal({ cuisines: ['Thai'], spiceLevel: 4 });
    const far = meal({ cuisines: ['Thai'], distanceKm: 40 });
    const okay = meal({ cuisines: ['Thai'], spiceLevel: 1 });
    const declaredAllergen = meal({ cuisines: ['Thai'], allergens: ['peanut'] });
    const prefs = { ...EMPTY_PREFERENCES, avoidTags: ['peanut'], maxSpiceLevel: 2 };
    const ranked = rankFeed([peanut, hot, far, okay, declaredAllergen], emptyTasteProfile(), prefs, ctx(), CONFIG);
    expect(ranked.map((r) => r.candidate.videoId)).toEqual([okay.videoId]);
  });

  it('boosts sushi on Friday evenings for a Friday-night sushi habit', () => {
    let profile = emptyTasteProfile();
    const fridays = ['2026-10-09T08:00:00Z', '2026-10-16T08:30:00Z', '2026-10-23T09:00:00Z', '2026-10-30T08:15:00Z'];
    for (const f of fridays) profile = train(profile, 'order_completed', meal({ cuisines: ['Japanese'], tags: ['sushi'] }), 1, new Date(f));
    const sushi = meal({ cuisines: ['Japanese'], tags: ['sushi'] });
    const friday = scoreCandidate(sushi, profile, EMPTY_PREFERENCES, ctx(), CONFIG);
    const tuesdayMorning = scoreCandidate(sushi, profile, EMPTY_PREFERENCES, ctx({ now: new Date('2026-11-03T22:00:00Z') }), CONFIG);
    expect(friday.components.timeOfWeek).toBeGreaterThan(0.3);
    expect(friday.total).toBeGreaterThan(tuesdayMorning.total);
    expect(tuesdayMorning.components.timeOfWeek).toBe(0);
  });

  it('price compatibility favours meals near the customer budget', () => {
    const prefs = { ...EMPTY_PREFERENCES, budgetPerMealCents: 1800 };
    const fits = scoreCandidate(meal({ cuisines: ['Thai'], priceCents: 1900 }), emptyTasteProfile(), prefs, ctx(), CONFIG);
    const pricey = scoreCandidate(meal({ cuisines: ['Thai'], priceCents: 7500 }), emptyTasteProfile(), prefs, ctx(), CONFIG);
    expect(fits.components.priceFit).toBeGreaterThan(pricey.components.priceFit!);
  });

  it('penalises repeatedly shown videos', () => {
    const m = meal({ cuisines: ['Thai'] });
    const fresh = scoreCandidate(m, emptyTasteProfile(), EMPTY_PREFERENCES, ctx(), CONFIG);
    const seen = scoreCandidate(m, emptyTasteProfile(), EMPTY_PREFERENCES, ctx({ impressionCounts: new Map([[m.videoId, 3]]) }), CONFIG);
    expect(seen.total).toBeLessThan(fresh.total);
  });

  it('avoids the same restaurant back-to-back', () => {
    const a1 = meal({ cuisines: ['Thai'], restaurantId: 'rA', trendingScore: 0.9 });
    const a2 = meal({ cuisines: ['Thai'], restaurantId: 'rA', trendingScore: 0.88 });
    const b1 = meal({ cuisines: ['Thai'], restaurantId: 'rB', trendingScore: 0.8 });
    const ranked = rankFeed([a1, a2, b1], emptyTasteProfile(), EMPTY_PREFERENCES, ctx(), { ...CONFIG, explorationRate: 0 });
    expect(ranked.map((r) => r.candidate.restaurantId)).toEqual(['rA', 'rB', 'rA']);
  });

  it('explores unfamiliar cuisines and is deterministic for a seed', () => {
    let profile = emptyTasteProfile();
    const pool: FeedCandidate[] = [];
    for (let i = 0; i < 30; i++) pool.push(meal({ cuisines: ['Japanese'], trendingScore: 0.9 }));
    for (let i = 0; i < 10; i++) pool.push(meal({ cuisines: ['Ethiopian'], trendingScore: 0.1 }));
    profile = train(profile, 'crave_swipe', pool[0]!, 10);
    const cfg = { ...CONFIG, explorationRate: 0.3 };
    const a = rankFeed(pool, profile, EMPTY_PREFERENCES, ctx({ seed: 7 }), cfg, 20);
    const b = rankFeed(pool, profile, EMPTY_PREFERENCES, ctx({ seed: 7 }), cfg, 20);
    expect(a.map((r) => r.candidate.videoId)).toEqual(b.map((r) => r.candidate.videoId));
    const explored = a.filter((r) => r.exploration);
    expect(explored.length).toBeGreaterThan(0);
    expect(explored.every((r) => r.candidate.cuisines.includes('Ethiopian'))).toBe(true);
    expect(explored[0]!.reasons).toContain('Something new to try');
  });

  it('orderableOnly returns only meals that can be ordered right now', () => {
    const open = meal({ cuisines: ['Thai'] });
    const closed = meal({ cuisines: ['Thai'], orderable: false });
    const ranked = rankFeed([open, closed], emptyTasteProfile(), EMPTY_PREFERENCES, ctx({ orderableOnly: true }), CONFIG);
    expect(ranked.map((r) => r.candidate.videoId)).toEqual([open.videoId]);
  });
});
