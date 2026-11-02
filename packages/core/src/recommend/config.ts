/**
 * Ranking configuration. Every number here is a tunable weight; administrators can override any of
 * them through platform_settings.ranking_weights (validated by mergeRankingConfig). Keep defaults
 * conservative and explainable — they should be tuned against real engagement/order data.
 */
export interface RankingConfig {
  modelVersion: string;
  /** Strength of each behavioural signal before decay. Negative = less like this. */
  signals: {
    rightSwipe: number; leftSwipe: number; order: number; repeatOrder: number; save: number; like: number;
    menuItemClick: number; orderClick: number; addToBasket: number; longWatch: number; replay: number; quickSkip: number;
  };
  /** How much a signal on an item spreads to each of its attributes. */
  featureTypes: { restaurant: number; category: number; cuisine: number; tag: number; price: number; creator: number; cert: number };
  /** Older activity counts less: weight halves every N days. */
  halfLifeDays: number;
  /** tanh squashing scale: raw evidence of this size ≈ 0.76 affinity. */
  affinityScale: number;
  /** Floor for any learned affinity so no category is ever effectively excluded by behaviour alone. */
  minAffinity: number;
  /** Evidence needed for full personalisation strength (cold-start shrinkage). */
  fullConfidenceEvidence: number;
  score: {
    affinity: number; favouriteCuisine: number; dislikedCuisine: number; context: number; price: number;
    trending: number; freshness: number; distancePerKm: number; freeDistanceKm: number;
    orderable: number; notOrderable: number; recentlySeen: number; alreadyCraved: number; spiceMismatch: number;
  };
  freshnessHalfLifeDays: number;
  exploration: { every: number; offset: number; maxAbsAffinity: number };
  diversity: { sameRestaurantWindow: number; sameRestaurantPenalty: number; sameCuisineWindow: number; sameCuisinePenalty: number };
  rejectedVideoDays: number;
  recentlySeenDays: number;
  lookbackDays: number;
  quickSkip: { maxWatchMs: number; maxCompletionPct: number };
  longWatch: { minWatchMs: number; minCompletionPct: number };
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  modelVersion: 'rules-v1',
  signals: {
    rightSwipe: 3, leftSwipe: -2, order: 5, repeatOrder: 7, save: 1.5, like: 1,
    menuItemClick: 1.5, orderClick: 2, addToBasket: 2.5, longWatch: 0.5, replay: 0.8, quickSkip: -0.3,
  },
  featureTypes: { restaurant: 1, category: 0.8, cuisine: 0.7, tag: 0.35, price: 0.3, creator: 0.5, cert: 0.5 },
  halfLifeDays: 30,
  affinityScale: 4,
  minAffinity: -0.6,
  fullConfidenceEvidence: 12,
  score: {
    affinity: 1.2, favouriteCuisine: 0.6, dislikedCuisine: -1.2, context: 0.5, price: 0.3,
    trending: 0.5, freshness: 0.3, distancePerKm: -0.03, freeDistanceKm: 3,
    orderable: 0.4, notOrderable: -0.4, recentlySeen: -0.8, alreadyCraved: -0.25, spiceMismatch: -0.5,
  },
  freshnessHalfLifeDays: 7,
  exploration: { every: 5, offset: 3, maxAbsAffinity: 0.25 },
  diversity: { sameRestaurantWindow: 2, sameRestaurantPenalty: 0.6, sameCuisineWindow: 2, sameCuisinePenalty: 0.25 },
  rejectedVideoDays: 60,
  recentlySeenDays: 3,
  lookbackDays: 120,
  quickSkip: { maxWatchMs: 2000, maxCompletionPct: 20 },
  longWatch: { minWatchMs: 10000, minCompletionPct: 75 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Applies admin overrides onto defaults. Unknown keys and non-finite numbers are ignored (and
 * reported) so a bad setting can never break the feed.
 */
export function mergeRankingConfig(overrides: unknown, base: RankingConfig = DEFAULT_RANKING_CONFIG): { config: RankingConfig; ignored: string[] } {
  const ignored: string[] = [];
  const walk = (b: any, o: any, path: string): any => {
    if (o == null || typeof o !== 'object' || Array.isArray(o)) return b;
    const out: any = { ...b };
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in b)) { ignored.push(p); continue; }
      if (typeof b[k] === 'object' && b[k] !== null) out[k] = walk(b[k], v, p);
      else if (typeof b[k] === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof b[k] === 'string' && typeof v === 'string' && v.length <= 40) out[k] = v;
      else ignored.push(p);
    }
    return out;
  };
  return { config: walk(base, overrides as DeepPartial<RankingConfig>, ''), ignored };
}
