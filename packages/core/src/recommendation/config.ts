import { z } from 'zod';

/**
 * All recommendation weights live in one validated, versioned config object.
 * Production values are stored in `recommendation_configs` and edited by admins;
 * these defaults are a reasoned starting point to be tuned against real data.
 */
export const SignalWeightsSchema = z.object({
  crave_swipe: z.number(),
  not_for_me_swipe: z.number(),
  order_completed: z.number(),
  repeat_order: z.number(),
  save_meal: z.number(),
  unsave_meal: z.number(),
  like: z.number(),
  share: z.number(),
  comment: z.number(),
  menu_item_click: z.number(),
  add_to_basket: z.number(),
  completed_view: z.number(),
  long_view: z.number(),
  partial_view: z.number(),
  quick_skip: z.number(),
  search: z.number(),
  follow_restaurant: z.number(),
  follow_creator: z.number(),
});

export type SignalWeights = z.infer<typeof SignalWeightsSchema>;
export type SignalType = keyof SignalWeights;

/** How much a signal propagates to each feature dimension of the meal. */
export const DimensionMultipliersSchema = z.object({
  item: z.number(),
  restaurant: z.number(),
  creator: z.number(),
  cuisine: z.number(),
  category: z.number(),
  tag: z.number(),
  priceBand: z.number(),
});
export type DimensionMultipliers = z.infer<typeof DimensionMultipliersSchema>;
export type Dimension = keyof DimensionMultipliers;

export const RankingWeightsSchema = z.object({
  affinity: DimensionMultipliersSchema,
  priceFit: z.number(),
  proximity: z.number(),
  freshness: z.number(),
  trending: z.number(),
  orderable: z.number(),
  timeOfWeek: z.number(),
  explicitCuisine: z.number(),
  explicitDietaryPreference: z.number(),
  following: z.number(),
  seenPenaltyPerImpression: z.number(),
  maxSeenPenalty: z.number(),
});
export type RankingWeights = z.infer<typeof RankingWeightsSchema>;

export const RecommendationConfigSchema = z.object({
  version: z.string(),
  signalWeights: SignalWeightsSchema,
  /** Multipliers applied when propagating a POSITIVE signal. */
  positivePropagation: DimensionMultipliersSchema,
  /**
   * Multipliers applied when propagating a NEGATIVE signal. Broad dimensions
   * (cuisine, category) are heavily damped so one left swipe never buries a
   * whole cuisine.
   */
  negativePropagation: DimensionMultipliersSchema,
  ranking: RankingWeightsSchema,
  /** Half-life (days) for time decay of learned affinities. */
  affinityHalfLifeDays: z.number().positive(),
  /** Affinity scores are clamped to [floor, ceiling] per dimension. */
  affinityCeiling: z.number().positive(),
  /** Broad-dimension floors; cuisines/categories can never drop below this. */
  broadDimensionFloor: z.number().max(0),
  /** Narrow-dimension floor (specific item / tag). */
  narrowDimensionFloor: z.number().max(0),
  /** Softens raw affinity into roughly -1..1 via tanh(score / scale). */
  affinityScale: z.number().positive(),
  /** Fraction of feed slots reserved for exploration (0..0.5). */
  explorationRate: z.number().min(0).max(0.5),
  /** Penalty applied to a candidate whose restaurant appeared in the last N slots. */
  diversityWindow: z.number().int().min(0),
  diversityPenalty: z.number().min(0),
  /** Distance (km) at which proximity score halves. */
  proximityHalfDistanceKm: z.number().positive(),
  /** Hard limit; candidates further away are excluded. */
  maxDistanceKm: z.number().positive(),
  /** Days after which freshness halves. */
  freshnessHalfLifeDays: z.number().positive(),
  /** Number of learned signals below which the user is treated as cold-start. */
  coldStartSignalThreshold: z.number().int().min(0),
});

export type RecommendationConfig = z.infer<typeof RecommendationConfigSchema>;

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  version: '2026-11-v1',
  signalWeights: {
    crave_swipe: 5,
    not_for_me_swipe: -4,
    order_completed: 8,
    repeat_order: 10,
    save_meal: 3,
    unsave_meal: -1.5,
    like: 2,
    share: 2,
    comment: 1,
    menu_item_click: 2.5,
    add_to_basket: 3.5,
    completed_view: 1.25,
    long_view: 0.75,
    partial_view: 0.1,
    quick_skip: -0.4,
    search: 1,
    follow_restaurant: 3,
    follow_creator: 2,
  },
  positivePropagation: { item: 1, restaurant: 0.6, creator: 0.4, cuisine: 0.5, category: 0.5, tag: 0.35, priceBand: 0.3 },
  negativePropagation: { item: 1, restaurant: 0.3, creator: 0.25, cuisine: 0.12, category: 0.12, tag: 0.2, priceBand: 0.05 },
  ranking: {
    affinity: { item: 1.2, restaurant: 1.0, creator: 0.6, cuisine: 1.4, category: 1.0, tag: 0.8, priceBand: 0.4 },
    priceFit: 0.8,
    proximity: 1.0,
    freshness: 0.5,
    trending: 1.0,
    orderable: 0.8,
    timeOfWeek: 0.9,
    explicitCuisine: 1.2,
    explicitDietaryPreference: 0.8,
    following: 1.0,
    seenPenaltyPerImpression: 0.35,
    maxSeenPenalty: 2.5,
  },
  affinityHalfLifeDays: 45,
  affinityCeiling: 30,
  broadDimensionFloor: -4,
  narrowDimensionFloor: -15,
  affinityScale: 8,
  explorationRate: 0.15,
  diversityWindow: 3,
  diversityPenalty: 0.9,
  proximityHalfDistanceKm: 4,
  maxDistanceKm: 25,
  freshnessHalfLifeDays: 14,
  coldStartSignalThreshold: 8,
};

export function parseRecommendationConfig(input: unknown): RecommendationConfig {
  return RecommendationConfigSchema.parse(input);
}

export const BROAD_DIMENSIONS: ReadonlySet<Dimension> = new Set(['cuisine', 'category', 'priceBand']);
