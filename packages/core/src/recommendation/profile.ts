import { localClock } from '../availability';
import { BROAD_DIMENSIONS, type Dimension, type RecommendationConfig, type SignalType } from './config';
import { priceBand, type AffinityEntry, type DaypartKey, type MealFeatures, type TasteProfile } from './types';

const DAY_MS = 86_400_000;

export function daypart(minutes: number): 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late' {
  const h = Math.floor(minutes / 60);
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'dinner';
  return 'late';
}

export function daypartKey(at: Date, timeZone: string): DaypartKey {
  const clock = localClock(at, timeZone);
  return `${clock.dayOfWeek}:${daypart(clock.minutes)}`;
}

/** Exponential time decay of an affinity score. */
export function decayedScore(entry: AffinityEntry | undefined, at: Date, halfLifeDays: number): number {
  if (!entry) return 0;
  const elapsedDays = Math.max(0, (at.getTime() - new Date(entry.updatedAt).getTime()) / DAY_MS);
  return entry.score * Math.pow(0.5, elapsedDays / halfLifeDays);
}

/** Feature keys of a meal, grouped by dimension. */
export function featureKeys(f: MealFeatures): Record<Dimension, string[]> {
  return {
    item: f.menuItemId ? [f.menuItemId] : f.videoId ? [`video:${f.videoId}`] : [],
    restaurant: f.restaurantId ? [f.restaurantId] : [],
    creator: f.creatorId ? [f.creatorId] : [],
    cuisine: f.cuisines.map((c) => c.toLowerCase()),
    category: f.category ? [f.category.toLowerCase()] : [],
    tag: f.tags.map((t) => t.toLowerCase()),
    priceBand: f.priceCents !== null ? [priceBand(f.priceCents)] : [],
  };
}

export interface SignalContext {
  at: Date;
  timeZone: string;
  /** Price actually paid per item (orders only). */
  paidItemCents?: number;
  fulfilment?: 'pickup' | 'delivery';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure function: returns a NEW taste profile with the signal applied.
 *
 * Design notes
 * - Negative signals propagate weakly to broad dimensions (cuisine, category),
 *   and broad dimensions have a floor, so a single "not for me" can't exclude
 *   an entire cuisine — it takes consistent rejection to meaningfully reduce it.
 * - "Not for me" hides that exact video permanently.
 * - Orders feed habit learning (time of week, spend, pickup vs delivery). Passive
 *   viewing never does.
 */
export function applySignal(
  profile: TasteProfile,
  signal: SignalType,
  features: MealFeatures,
  ctx: SignalContext,
  config: RecommendationConfig,
): TasteProfile {
  let effectiveSignal: SignalType = signal;
  if (signal === 'order_completed' && features.menuItemId && profile.orderedItemIds.includes(features.menuItemId)) {
    effectiveSignal = 'repeat_order';
  }

  const weight = config.signalWeights[effectiveSignal];
  const propagation = weight >= 0 ? config.positivePropagation : config.negativePropagation;
  const keys = featureKeys(features);
  const nowIso = ctx.at.toISOString();

  const affinities = { ...profile.affinities };
  for (const dim of Object.keys(keys) as Dimension[]) {
    const dimKeys = keys[dim];
    if (dimKeys.length === 0) continue;
    const floor = BROAD_DIMENSIONS.has(dim) ? config.broadDimensionFloor : config.narrowDimensionFloor;
    // Split multi-valued dimensions (tags, cuisines) so a meal with many tags doesn't dominate.
    const share = dim === 'tag' || dim === 'cuisine' ? 1 / Math.sqrt(dimKeys.length) : 1;
    const delta = weight * propagation[dim] * share;
    if (delta === 0) continue;
    const map = { ...affinities[dim] };
    for (const key of dimKeys) {
      const current = decayedScore(map[key], ctx.at, config.affinityHalfLifeDays);
      map[key] = { score: clamp(current + delta, floor, config.affinityCeiling), updatedAt: nowIso };
    }
    affinities[dim] = map;
  }

  const next: TasteProfile = {
    ...profile,
    affinities,
    signalCount: profile.signalCount + 1,
  };

  if (signal === 'not_for_me_swipe' && features.videoId && !profile.hiddenVideoIds.includes(features.videoId)) {
    // Keep the list bounded; oldest hidden videos fall off after 2000 entries.
    next.hiddenVideoIds = [...profile.hiddenVideoIds, features.videoId].slice(-2000);
  }

  if (signal === 'order_completed') {
    const slot = daypartKey(ctx.at, ctx.timeZone);
    const orderTimes = { ...profile.orderTimes };
    for (const cuisine of keys.cuisine) {
      const k = `${cuisine}@${slot}`;
      orderTimes[k] = (orderTimes[k] ?? 0) + 1;
    }
    next.orderTimes = orderTimes;

    const paid = ctx.paidItemCents ?? features.priceCents;
    if (paid !== null && paid !== undefined) {
      next.avgOrderItemCents =
        profile.avgOrderItemCents === null ? paid : Math.round(profile.avgOrderItemCents * 0.8 + paid * 0.2);
    }
    if (ctx.fulfilment) {
      next.fulfilmentCounts = {
        ...profile.fulfilmentCounts,
        [ctx.fulfilment]: profile.fulfilmentCounts[ctx.fulfilment] + 1,
      };
    }
    if (features.menuItemId && !profile.orderedItemIds.includes(features.menuItemId)) {
      next.orderedItemIds = [...profile.orderedItemIds, features.menuItemId].slice(-500);
    }
  }

  return next;
}

/** Signal for a search query: boosts tags/cuisines whose names appear in the query. */
export function searchFeatures(query: string, knownTags: readonly string[], knownCuisines: readonly string[]): MealFeatures {
  const q = query.toLowerCase();
  return {
    videoId: null,
    menuItemId: null,
    restaurantId: null,
    creatorId: null,
    cuisines: knownCuisines.filter((c) => q.includes(c.toLowerCase())),
    category: null,
    tags: knownTags.filter((t) => q.includes(t.toLowerCase())),
    priceCents: null,
  };
}
