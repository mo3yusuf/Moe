import type { Dimension, RecommendationConfig } from './config';
import { daypartKey, decayedScore, featureKeys } from './profile';
import type { ExplicitPreferences, FeedCandidate, RankedItem, RankingContext, TasteProfile } from './types';

const DAY_MS = 86_400_000;

/** Small, fast, deterministic PRNG so exploration is reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type ExclusionReason = 'hidden' | 'too_far' | 'dietary_requirement' | 'avoided_tag' | 'too_spicy' | 'not_orderable';

/** Hard filters. These are rules, not preferences, so they run before scoring. */
export function exclusionReason(
  c: FeedCandidate,
  profile: TasteProfile,
  prefs: ExplicitPreferences,
  ctx: RankingContext,
  config: RecommendationConfig,
): ExclusionReason | null {
  if (profile.hiddenVideoIds.includes(c.videoId)) return 'hidden';
  if (c.distanceKm !== null && c.distanceKm > config.maxDistanceKm) return 'too_far';
  if (prefs.dietaryRequirements.length > 0 && !prefs.dietaryRequirements.every((r) => c.verifiedDietary.includes(r))) {
    return 'dietary_requirement';
  }
  if (prefs.avoidTags.length > 0) {
    const tags = new Set(c.tags.map((t) => t.toLowerCase()));
    if (prefs.avoidTags.some((t) => tags.has(t.toLowerCase()))) return 'avoided_tag';
  }
  if (prefs.maxSpiceLevel !== null && c.spiceLevel !== null && c.spiceLevel > prefs.maxSpiceLevel) return 'too_spicy';
  if (ctx.orderableOnly && !c.orderable) return 'not_orderable';
  return null;
}

export interface ScoreBreakdown {
  total: number;
  components: Record<string, number>;
  topAffinity: { dimension: Dimension; key: string; value: number } | null;
}

function priceFit(priceCents: number | null, targetCents: number | null): number {
  if (priceCents === null || targetCents === null || priceCents <= 0 || targetCents <= 0) return 0;
  const logRatio = Math.log(priceCents / targetCents);
  const fit = Math.exp(-(logRatio * logRatio) / (2 * 0.35 * 0.35)); // 0..1
  return fit * 2 - 1; // -1..1
}

export function scoreCandidate(
  c: FeedCandidate,
  profile: TasteProfile,
  prefs: ExplicitPreferences,
  ctx: RankingContext,
  config: RecommendationConfig,
): ScoreBreakdown {
  const w = config.ranking;
  const confidence = config.coldStartSignalThreshold === 0 ? 1 : Math.min(1, profile.signalCount / config.coldStartSignalThreshold);
  const coldBoost = 1 + (1 - confidence) * 0.5;
  const components: Record<string, number> = {};

  // Learned affinity, per dimension.
  const keys = featureKeys(c);
  let affinity = 0;
  let topAffinity: ScoreBreakdown['topAffinity'] = null;
  for (const dim of Object.keys(keys) as Dimension[]) {
    const dimKeys = keys[dim];
    if (dimKeys.length === 0) continue;
    let sum = 0;
    for (const key of dimKeys) {
      const v = Math.tanh(decayedScore(profile.affinities[dim][key], ctx.now, config.affinityHalfLifeDays) / config.affinityScale);
      sum += v;
      if (v > 0.15 && (!topAffinity || v > topAffinity.value) && dim !== 'item' && dim !== 'priceBand') {
        topAffinity = { dimension: dim, key, value: v };
      }
    }
    affinity += w.affinity[dim] * (sum / dimKeys.length);
  }
  components.affinity = affinity * confidence;

  const target = prefs.budgetPerMealCents ?? profile.avgOrderItemCents;
  components.priceFit = w.priceFit * priceFit(c.priceCents, target);

  components.proximity = w.proximity * coldBoost * (c.distanceKm === null ? 0.3 : Math.pow(0.5, c.distanceKm / config.proximityHalfDistanceKm));

  const ageDays = Math.max(0, (ctx.now.getTime() - new Date(c.publishedAt).getTime()) / DAY_MS);
  components.freshness = w.freshness * Math.pow(0.5, ageDays / config.freshnessHalfLifeDays);

  components.trending = w.trending * coldBoost * Math.max(0, Math.min(1, c.trendingScore));
  components.orderable = c.orderable ? w.orderable : 0;

  const slot = daypartKey(ctx.now, ctx.timeZone);
  const habit = keys.cuisine.reduce((acc, cuisine) => acc + (profile.orderTimes[`${cuisine}@${slot}`] ?? 0), 0);
  components.timeOfWeek = w.timeOfWeek * (1 - 1 / (1 + habit)) * confidence;

  const favourites = new Set(prefs.favouriteCuisines.map((x) => x.toLowerCase()));
  components.explicitCuisine = keys.cuisine.some((x) => favourites.has(x)) ? w.explicitCuisine : 0;

  components.explicitDietaryPreference =
    prefs.dietaryPreferences.length === 0
      ? 0
      : w.explicitDietaryPreference *
        (prefs.dietaryPreferences.filter((p) => c.verifiedDietary.includes(p)).length / prefs.dietaryPreferences.length);

  const followsRestaurant = c.restaurantId !== null && ctx.followedRestaurantIds.has(c.restaurantId);
  const followsCreator = c.creatorId !== null && ctx.followedCreatorIds.has(c.creatorId);
  components.following = followsRestaurant || followsCreator ? w.following : 0;

  const seen = ctx.impressionCounts.get(c.videoId) ?? 0;
  components.seen = -Math.min(w.maxSeenPenalty, seen * w.seenPenaltyPerImpression);

  const total = Object.values(components).reduce((a, b) => a + b, 0);
  return { total, components, topAffinity };
}

function explain(c: FeedCandidate, b: ScoreBreakdown, ctx: RankingContext, exploration: boolean, cuisineNames: Map<string, string>): string[] {
  const reasons: string[] = [];
  if (exploration) reasons.push('Something new to try');
  if (b.components.following && b.components.following > 0) reasons.push('From someone you follow');
  if (b.topAffinity) {
    const label = b.topAffinity.dimension === 'cuisine' ? cuisineNames.get(b.topAffinity.key) ?? b.topAffinity.key : null;
    if (label) reasons.push(`Because you crave ${label}`);
    else if (b.topAffinity.dimension === 'restaurant') reasons.push('From a restaurant you like');
    else if (b.topAffinity.dimension === 'tag') reasons.push(`Because you like ${b.topAffinity.key}`);
  }
  if ((b.components.timeOfWeek ?? 0) > 0.2) reasons.push('Popular with you at this time');
  if ((b.components.explicitCuisine ?? 0) > 0) reasons.push('Matches your food preferences');
  if (c.trendingScore >= 0.7) reasons.push('Trending in your area');
  if (c.distanceKm !== null && c.distanceKm <= 2) reasons.push('Close to you');
  void ctx;
  return reasons.slice(0, 2);
}

/**
 * Rank a candidate pool into a feed page.
 *
 * 1. Hard filters (hidden videos, dietary requirements, distance, spice, avoid tags).
 * 2. Score every remaining candidate.
 * 3. Greedy assembly with a diversity penalty (avoid the same restaurant back-to-back)
 *    and exploration slots that surface cuisines the customer hasn't shown interest in.
 */
export function rankFeed(
  candidates: readonly FeedCandidate[],
  profile: TasteProfile,
  prefs: ExplicitPreferences,
  ctx: RankingContext,
  config: RecommendationConfig,
  limit = 20,
): RankedItem[] {
  const rng = mulberry32(ctx.seed);
  const cuisineNames = new Map<string, string>();
  const pool = candidates
    .filter((c) => exclusionReason(c, profile, prefs, ctx, config) === null)
    .map((c) => {
      for (const name of c.cuisines) cuisineNames.set(name.toLowerCase(), name);
      return { c, b: scoreCandidate(c, profile, prefs, ctx, config) };
    })
    .sort((x, y) => y.b.total - x.b.total || x.c.videoId.localeCompare(y.c.videoId));

  const favourites = new Set(prefs.favouriteCuisines.map((x) => x.toLowerCase()));
  const isUnfamiliar = (c: FeedCandidate) =>
    c.cuisines.every((cu) => {
      const key = cu.toLowerCase();
      return !favourites.has(key) && decayedScore(profile.affinities.cuisine[key], ctx.now, config.affinityHalfLifeDays) <= 1;
    });

  const result: RankedItem[] = [];
  const used = new Set<string>();
  while (result.length < limit && used.size < pool.length) {
    const recentRestaurants = new Set(
      result.slice(-config.diversityWindow).map((r) => r.candidate.restaurantId).filter((x): x is string => x !== null),
    );
    const available = pool.filter((p) => !used.has(p.c.videoId));
    let pick: (typeof pool)[number] | undefined;
    let exploration = false;

    if (result.length > 0 && rng() < config.explorationRate) {
      const unfamiliar = available.filter((p) => isUnfamiliar(p.c) && !recentRestaurants.has(p.c.restaurantId ?? ''));
      if (unfamiliar.length > 0) {
        pick = unfamiliar[Math.floor(rng() * unfamiliar.length)];
        exploration = true;
      }
    }

    if (!pick) {
      let best = -Infinity;
      for (const p of available) {
        const adjusted = p.b.total - (p.c.restaurantId && recentRestaurants.has(p.c.restaurantId) ? config.diversityPenalty : 0);
        if (adjusted > best) {
          best = adjusted;
          pick = p;
        }
      }
    }
    if (!pick) break;
    used.add(pick.c.videoId);
    result.push({
      candidate: pick.c,
      score: pick.b.total,
      reasons: explain(pick.c, pick.b, ctx, exploration, cuisineNames),
      exploration,
    });
  }
  return result;
}
