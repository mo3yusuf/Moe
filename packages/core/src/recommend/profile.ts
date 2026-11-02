import type { FeedCandidate } from '../feed-types';
import type { DietaryTag } from '../constants';
import { DEFAULT_RANKING_CONFIG, type RankingConfig } from './config';
import { contextKeys } from './context';

/** Attributes of a meal/video that preferences attach to. */
export interface ItemFeatures {
  restaurantId?: string | null;
  cuisine?: string | null;
  category?: string | null;
  tags?: string[];
  priceLevel?: number | null;
  creatorId?: string | null;
  halalCertified?: boolean;
  priceCents?: number | null;
}

export type SignalKind =
  | 'right_swipe' | 'left_swipe' | 'order' | 'save' | 'like' | 'menu_item_click' | 'order_click'
  | 'add_to_basket' | 'watch' | 'replay';

export interface Signal {
  kind: SignalKind;
  at: Date;
  videoId?: string | null;
  menuItemId?: string | null;
  item: ItemFeatures;
  watchMs?: number | null;
  completionPct?: number | null;
}

/** Preferences the customer chose explicitly. Dietary requirements only ever come from here. */
export interface ExplicitPreferences {
  favouriteCuisines: string[];
  dislikedCuisines: string[];
  dietaryRequirements: DietaryTag[];
  /** Allergens to hide: dishes DECLARED to contain them are filtered out. */
  avoidAllergens?: string[];
  spicePreference: number | null;
  typicalBudgetCents: number | null;
}

export const EMPTY_PREFERENCES: ExplicitPreferences = {
  favouriteCuisines: [], dislikedCuisines: [], dietaryRequirements: [], avoidAllergens: [], spicePreference: null, typicalBudgetCents: null,
};

export interface TasteProfile {
  /** Squashed affinities in [minAffinity, 1]. */
  affinities: Map<string, number>;
  /** Contextual (time-of-week) affinities from orders, e.g. ctx:fri_evening:cuisine:japanese. */
  context: Map<string, number>;
  /** Total absolute decayed evidence — drives cold-start shrinkage. */
  evidence: number;
  /** Median spend per item from orders (cents), if any. */
  typicalSpendCents: number | null;
  rejectedVideos: Set<string>;
  recentlySeen: Set<string>;
  craved: Set<string>;
  signalCount: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Feature keys (and their spread weights) for an item. */
export function featureKeys(item: ItemFeatures, cfg: RankingConfig = DEFAULT_RANKING_CONFIG): [string, number][] {
  const ft = cfg.featureTypes;
  const out: [string, number][] = [];
  if (item.restaurantId) out.push([`restaurant:${item.restaurantId}`, ft.restaurant]);
  if (item.category) out.push([`category:${norm(item.category)}`, ft.category]);
  if (item.cuisine) out.push([`cuisine:${norm(item.cuisine)}`, ft.cuisine]);
  for (const t of new Set(item.tags ?? [])) out.push([`tag:${norm(t)}`, ft.tag]);
  if (item.priceLevel) out.push([`price:${item.priceLevel}`, ft.price]);
  if (item.creatorId) out.push([`creator:${item.creatorId}`, ft.creator]);
  if (item.halalCertified) out.push(['cert:halal', ft.cert]);
  return out;
}

export function candidateFeatures(c: FeedCandidate): ItemFeatures {
  return {
    restaurantId: c.restaurantId,
    cuisine: c.itemCuisine ?? c.cuisines[0] ?? null,
    category: c.itemCategory,
    tags: c.itemTags,
    priceLevel: c.priceLevel,
    creatorId: c.source === 'restaurant' ? null : c.uploaderId,
    halalCertified: c.halalCertified,
    priceCents: c.priceCents,
  };
}

/** Value of one signal before time decay. Returns 0 for neutral events. */
export function signalValue(s: Signal, cfg: RankingConfig = DEFAULT_RANKING_CONFIG): number {
  const w = cfg.signals;
  switch (s.kind) {
    case 'right_swipe': return w.rightSwipe;
    case 'left_swipe': return w.leftSwipe;
    case 'order': return w.order; // repeat orders are upgraded in buildTasteProfile
    case 'save': return w.save;
    case 'like': return w.like;
    case 'menu_item_click': return w.menuItemClick;
    case 'order_click': return w.orderClick;
    case 'add_to_basket': return w.addToBasket;
    case 'replay': return w.replay;
    case 'watch': {
      const ms = s.watchMs ?? 0;
      const pct = s.completionPct ?? 0;
      if (ms <= cfg.quickSkip.maxWatchMs && pct <= cfg.quickSkip.maxCompletionPct) return w.quickSkip;
      if (ms >= cfg.longWatch.minWatchMs || pct >= cfg.longWatch.minCompletionPct) return w.longWatch;
      return 0; // ordinary viewing: no signal
    }
  }
}

const DAY = 86_400_000;
export const decay = (ageMs: number, halfLifeDays: number) => Math.pow(0.5, Math.max(0, ageMs) / (halfLifeDays * DAY));

export interface ProfileInput {
  signals: Signal[];
  /** Impression history for de-duplication (video ids with time). */
  impressions?: { videoId: string; at: Date }[];
  now: Date;
  /** Signals before this moment are ignored (Reset My Taste Profile). */
  resetAt?: Date | null;
  timezone?: string;
}

export function buildTasteProfile(input: ProfileInput, cfg: RankingConfig = DEFAULT_RANKING_CONFIG): TasteProfile {
  const now = input.now.getTime();
  const minTime = Math.max(now - cfg.lookbackDays * DAY, input.resetAt?.getTime() ?? 0);
  const raw = new Map<string, number>();
  const context = new Map<string, number>();
  const rejectedVideos = new Set<string>();
  const craved = new Set<string>();
  const latestSwipe = new Map<string, { kind: SignalKind; at: number }>();
  const orderCounts = new Map<string, number>();
  const spends: number[] = [];
  let evidence = 0;
  let count = 0;

  const signals = input.signals
    .filter((s) => s.at.getTime() >= minTime && s.at.getTime() <= now + 60_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  for (const s of signals) {
    let value = signalValue(s, cfg);
    if (s.kind === 'order') {
      const key = s.menuItemId ?? `${s.item.restaurantId}:${s.item.category}`;
      const n = (orderCounts.get(key) ?? 0) + 1;
      orderCounts.set(key, n);
      if (n > 1) value = cfg.signals.repeatOrder;
      if (s.item.priceCents) spends.push(s.item.priceCents);
      // Learn time-of-week habits from orders only (strongest, explicit evidence).
      if (s.item.cuisine) {
        for (const k of contextKeys(s.at, input.timezone)) {
          const key2 = `${k}:cuisine:${norm(s.item.cuisine)}`;
          context.set(key2, (context.get(key2) ?? 0) + decay(now - s.at.getTime(), cfg.halfLifeDays * 2));
        }
      }
    }
    if (s.videoId && (s.kind === 'right_swipe' || s.kind === 'left_swipe')) {
      latestSwipe.set(s.videoId, { kind: s.kind, at: s.at.getTime() });
    }
    if (value === 0) continue;
    count += 1;
    const d = decay(now - s.at.getTime(), cfg.halfLifeDays);
    for (const [f, spread] of featureKeys(s.item, cfg)) {
      raw.set(f, (raw.get(f) ?? 0) + value * spread * d);
    }
    evidence += Math.abs(value) * d;
  }

  for (const [videoId, s] of latestSwipe) {
    if (s.kind === 'left_swipe' && now - s.at <= cfg.rejectedVideoDays * DAY) rejectedVideos.add(videoId);
    if (s.kind === 'right_swipe') craved.add(videoId);
  }

  const affinities = new Map<string, number>();
  for (const [f, v] of raw) affinities.set(f, Math.max(cfg.minAffinity, Math.tanh(v / cfg.affinityScale)));

  const contextAff = new Map<string, number>();
  for (const [k, v] of context) contextAff.set(k, Math.tanh(v / 2));

  const recentlySeen = new Set<string>();
  for (const imp of input.impressions ?? []) {
    if (imp.at.getTime() >= minTime && now - imp.at.getTime() <= cfg.recentlySeenDays * DAY) recentlySeen.add(imp.videoId);
  }

  spends.sort((a, b) => a - b);
  const typicalSpendCents = spends.length ? spends[Math.floor(spends.length / 2)]! : null;

  return { affinities, context: contextAff, evidence, typicalSpendCents, rejectedVideos, recentlySeen, craved, signalCount: count };
}

export function emptyProfile(): TasteProfile {
  return { affinities: new Map(), context: new Map(), evidence: 0, typicalSpendCents: null, rejectedVideos: new Set(), recentlySeen: new Set(), craved: new Set(), signalCount: 0 };
}
