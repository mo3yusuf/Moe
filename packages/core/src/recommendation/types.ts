import type { Dimension } from './config';

/** Price bands keep spending learning coarse (no need to store exact spend history). */
export type PriceBand = 'budget' | 'mid' | 'premium' | 'luxury';

export function priceBand(priceCents: number): PriceBand {
  if (priceCents < 1500) return 'budget';
  if (priceCents < 2800) return 'mid';
  if (priceCents < 4500) return 'premium';
  return 'luxury';
}

/** The feature set describing one meal/video, used both for learning and ranking. */
export interface MealFeatures {
  /** null for signals not tied to a video (e.g. a search or a menu-only order). */
  videoId: string | null;
  menuItemId: string | null;
  restaurantId: string | null;
  creatorId: string | null;
  cuisines: string[];
  category: string | null;
  /** Dish and ingredient tags, lower-case (e.g. 'burger', 'beef', 'cheese'). */
  tags: string[];
  priceCents: number | null;
}

export interface FeedCandidate extends MealFeatures {
  videoId: string;
  /** Distance from the customer, km. null if unknown (no location permission). */
  distanceKm: number | null;
  /** Restaurant active + accepting + item available + link approved (+ open or advance orders). */
  orderable: boolean;
  publishedAt: string; // ISO
  /** Normalised 0..1 popularity over the trending window (computed by a background job). */
  trendingScore: number;
  /** Restaurant-declared dietary attributes that CRAVE has verified, e.g. 'halal_certified'. */
  verifiedDietary: string[];
  /** Restaurant-declared allergens. Used ONLY for the customer's explicit "avoid" filter, never for learning. */
  allergens?: string[];
  /** Restaurant-declared spice level 0 (none) .. 4 (very hot). */
  spiceLevel: number | null;
  isSponsored: boolean;
}

export type DaypartKey = `${number}:${'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late'}`;

export interface AffinityEntry {
  score: number;
  /** ISO timestamp the score was last updated (used for time decay). */
  updatedAt: string;
}

export type AffinityMap = Record<string, AffinityEntry>;

/**
 * A learned taste profile. Only aggregated scores are stored — not a raw
 * browsing history — which keeps the stored personal information minimal.
 */
export interface TasteProfile {
  affinities: Record<Dimension, AffinityMap>;
  /** Cuisine ordering habits by weekday + daypart, learned from orders only. */
  orderTimes: Record<string, number>;
  /** Exponential moving average of ordered item prices, cents. */
  avgOrderItemCents: number | null;
  fulfilmentCounts: { pickup: number; delivery: number };
  /** Exact videos the customer said NOT FOR ME — never shown again. */
  hiddenVideoIds: string[];
  /** Number of learned signals so far (drives cold-start blending). */
  signalCount: number;
  /** Menu items the customer has ordered (for repeat-order detection). */
  orderedItemIds: string[];
}

/** Preferences the customer told us explicitly. Never inferred. */
export interface ExplicitPreferences {
  favouriteCuisines: string[];
  /** Hard requirements: only show meals carrying these verified attributes, e.g. ['halal_certified']. */
  dietaryRequirements: string[];
  /** Soft preferences: boost meals with these attributes, e.g. ['vegetarian']. */
  dietaryPreferences: string[];
  /** Ingredients/allergen tags the customer asked us to hide. */
  avoidTags: string[];
  /** 0..4, null = no preference. Meals hotter than this are hidden. */
  maxSpiceLevel: number | null;
  /** Typical budget per meal, cents (null = learn from orders). */
  budgetPerMealCents: number | null;
}

export const EMPTY_PREFERENCES: ExplicitPreferences = {
  favouriteCuisines: [],
  dietaryRequirements: [],
  dietaryPreferences: [],
  avoidTags: [],
  maxSpiceLevel: null,
  budgetPerMealCents: null,
};

export function emptyTasteProfile(): TasteProfile {
  return {
    affinities: { item: {}, restaurant: {}, creator: {}, cuisine: {}, category: {}, tag: {}, priceBand: {} },
    orderTimes: {},
    avgOrderItemCents: null,
    fulfilmentCounts: { pickup: 0, delivery: 0 },
    hiddenVideoIds: [],
    signalCount: 0,
    orderedItemIds: [],
  };
}

export interface RankingContext {
  now: Date;
  timeZone: string;
  followedRestaurantIds: ReadonlySet<string>;
  followedCreatorIds: ReadonlySet<string>;
  /** videoId → number of times already shown to this customer recently. */
  impressionCounts: ReadonlyMap<string, number>;
  /** Seed for deterministic exploration (e.g. hash of user id + session). */
  seed: number;
  /** When true, only orderable meals are returned (e.g. "Order now" shelf). */
  orderableOnly?: boolean;
}

export interface RankedItem {
  candidate: FeedCandidate;
  score: number;
  /** Customer-facing, privacy-safe explanation ("Because you craved Japanese"). */
  reasons: string[];
  exploration: boolean;
}
