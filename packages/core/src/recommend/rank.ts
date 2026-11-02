import type { DietaryTag } from '../constants';
import type { FeedCandidate } from '../feed-types';
import { DEFAULT_RANKING_CONFIG, type RankingConfig } from './config';
import { contextKeys } from './context';
import { candidateFeatures, decay, featureKeys, type ExplicitPreferences, type TasteProfile } from './profile';

export interface Scored {
  candidate: FeedCandidate;
  score: number;
  /** Breakdown of the score — used for reasons, debugging and admin evaluation. */
  parts: Record<string, number>;
  exploration: boolean;
  reasons: string[];
}

export interface RankInput {
  candidates: FeedCandidate[];
  profile: TasteProfile;
  preferences: ExplicitPreferences;
  /** False when the user has not consented to personalisation: behavioural affinities are ignored. */
  personalised: boolean;
  now: Date;
  limit: number;
  timezone?: string;
  /** Item-item collaborative scores in [0,1] for candidate videos (see collaborativeScores). */
  collaborative?: Map<string, number>;
  /** Deterministic randomness for exploration (tests / reproducible evaluation). */
  random?: () => number;
}

/** A dietary requirement is satisfied only by an explicit restaurant/item declaration or certification. */
export function satisfiesDietary(c: FeedCandidate, requirements: DietaryTag[]): boolean {
  if (!requirements.length) return true;
  if (!c.menuItemId) return false; // cannot verify content without a linked menu item
  const tags = new Set(c.dietaryTags);
  return requirements.every((r) => {
    switch (r) {
      case 'vegetarian': return tags.has('vegetarian') || tags.has('vegan');
      case 'dairy_free': return tags.has('dairy_free') || tags.has('vegan');
      case 'halal': return tags.has('halal') || c.halalCertified;
      default: return tags.has(r);
    }
  });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export function scoreCandidate(c: FeedCandidate, input: RankInput, cfg: RankingConfig = DEFAULT_RANKING_CONFIG): Scored {
  const w = cfg.score;
  const parts: Record<string, number> = {};
  const reasons: [number, string][] = [];
  const profile = input.personalised ? input.profile : null;
  const cuisine = (c.itemCuisine ?? c.cuisines[0] ?? '').toLowerCase();

  // Learned taste (shrunk towards zero for users with little history).
  if (profile && profile.affinities.size) {
    const confidence = Math.min(1, profile.evidence / cfg.fullConfidenceEvidence);
    let sum = 0, weights = 0, best: [number, string] | null = null;
    for (const [f, spread] of featureKeys(candidateFeatures(c), cfg)) {
      const a = profile.affinities.get(f) ?? 0;
      sum += a * spread;
      weights += spread;
      if (a > 0.15 && (!best || a * spread > best[0])) best = [a * spread, f];
    }
    if (weights > 0) parts.affinity = w.affinity * confidence * (sum / weights);
    if (best) {
      const [, f] = best;
      const label = f.startsWith('restaurant:') ? `From ${c.restaurantName}, a favourite of yours`
        : f.startsWith('cuisine:') ? `Because you crave ${cap(f.slice(8))}`
        : f.startsWith('category:') ? `More ${cap(f.slice(9))} for you`
        : f.startsWith('creator:') ? `From @${c.creatorHandle ?? 'a creator'} you enjoy`
        : f === 'cert:halal' ? 'Halal-certified, like your recent picks'
        : f.startsWith('tag:') ? `You like ${cap(f.slice(4))} dishes` : 'Matches your taste';
      reasons.push([parts.affinity ?? 0, label]);
    }
    // Habits: e.g. sushi on Friday evenings.
    let ctx = 0;
    for (const k of contextKeys(input.now, input.timezone)) ctx = Math.max(ctx, profile.context.get(`${k}:cuisine:${cuisine}`) ?? 0);
    if (ctx > 0) {
      parts.context = w.context * ctx;
      reasons.push([parts.context, `Your usual ${cap(cuisine)} time`]);
    }
    if (profile.recentlySeen.has(c.videoId)) parts.recentlySeen = w.recentlySeen;
    if (profile.craved.has(c.videoId)) parts.alreadyCraved = w.alreadyCraved;
  }

  // Collaborative signal: behavioural, so only with personalisation consent.
  if (profile) {
    const cf = input.collaborative?.get(c.videoId) ?? 0;
    if (cf > 0) {
      parts.collaborative = w.collaborative * cf;
      if (cf >= 0.3) reasons.push([parts.collaborative, 'Loved by people with your taste']);
    }
  }

  // Explicit preferences (always respected, even without behavioural personalisation).
  const prefs = input.preferences;
  if (cuisine && prefs.favouriteCuisines.map((x) => x.toLowerCase()).includes(cuisine)) {
    parts.favouriteCuisine = w.favouriteCuisine;
    reasons.push([w.favouriteCuisine, `${cap(cuisine)} is one of your favourites`]);
  }
  if (cuisine && prefs.dislikedCuisines.map((x) => x.toLowerCase()).includes(cuisine)) parts.dislikedCuisine = w.dislikedCuisine;
  if (prefs.spicePreference != null && c.spiceLevel != null && c.spiceLevel > prefs.spicePreference + 1) {
    parts.spiceMismatch = w.spiceMismatch;
  }

  // Price compatibility against explicit budget or learned typical spend.
  const target = prefs.typicalBudgetCents ?? profile?.typicalSpendCents ?? null;
  if (target && c.priceCents) {
    const ratio = Math.abs(Math.log(c.priceCents / target));
    parts.price = w.price * (1 - Math.min(1, ratio / Math.log(2))); // 1 at target, 0 at 2x/0.5x, negative never
  }

  // Popularity with Bayesian smoothing, so new videos aren't punished for lack of data.
  const s = c.stats;
  const engagement = (s.rightSwipes + s.likes * 0.5 + s.completions * 0.3 + s.orders * 3 - s.leftSwipes * 0.5) / (s.impressions + 20);
  parts.trending = w.trending * Math.max(-0.5, Math.min(1, engagement * 4));
  if (parts.trending > 0.25) reasons.push([parts.trending, 'Popular in Brisbane right now']);

  const ageMs = input.now.getTime() - Date.parse(c.publishedAt);
  parts.freshness = w.freshness * decay(ageMs, cfg.freshnessHalfLifeDays);
  if (ageMs < 2 * 86_400_000) reasons.push([parts.freshness, 'New this week']);

  if (c.distanceKm != null && c.distanceKm > w.freeDistanceKm) parts.distance = w.distancePerKm * (c.distanceKm - w.freeDistanceKm);
  else if (c.distanceKm != null && c.distanceKm <= 2) reasons.push([0.05, 'Close to you']);

  parts.orderable = c.orderable ? w.orderable : w.notOrderable;

  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  reasons.sort((a, b) => b[0] - a[0]);
  return { candidate: c, score, parts, exploration: false, reasons: reasons.slice(0, 2).map(([, r]) => r) };
}

/**
 * Full ranking pipeline:
 *  1. Hard filters: videos the user rejected (left swipe), unmet explicit dietary requirements.
 *  2. Score every candidate.
 *  3. Fill slots greedily with diversity penalties (same restaurant / cuisine back-to-back).
 *  4. Reserve every Nth slot for exploration: good content from cuisines the user hasn't
 *     expressed a view on, so tastes can broaden and the system avoids a filter bubble.
 */
export function rankFeed(input: RankInput, cfg: RankingConfig = DEFAULT_RANKING_CONFIG): Scored[] {
  const random = input.random ?? Math.random;
  const profile = input.personalised ? input.profile : null;

  const eligible = input.candidates.filter((c) =>
    !(profile?.rejectedVideos.has(c.videoId)) && satisfiesDietary(c, input.preferences.dietaryRequirements));

  const scored = eligible.map((c) => scoreCandidate(c, input, cfg)).sort((a, b) => b.score - a.score);
  const remaining = new Set(scored);
  const out: Scored[] = [];

  const cuisineOf = (c: FeedCandidate) => (c.itemCuisine ?? c.cuisines[0] ?? '').toLowerCase();
  const isUnfamiliar = (s: Scored) => {
    const a = profile?.affinities.get(`cuisine:${cuisineOf(s.candidate)}`) ?? 0;
    const disliked = input.preferences.dislikedCuisines.map((x) => x.toLowerCase()).includes(cuisineOf(s.candidate));
    return Math.abs(a) <= cfg.exploration.maxAbsAffinity && !disliked;
  };

  while (out.length < input.limit && remaining.size) {
    const position = out.length;
    const exploreSlot = cfg.exploration.every > 0 && position % cfg.exploration.every === cfg.exploration.offset;

    if (exploreSlot) {
      // Pick among the better half of unfamiliar candidates, weighted by quality, at random.
      const pool = [...remaining].filter((s) => isUnfamiliar(s) && s.candidate.orderable);
      const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 2)));
      if (top.length) {
        const pick = top[Math.floor(random() * top.length)]!;
        remaining.delete(pick);
        out.push({ ...pick, exploration: true, reasons: ['Something different to try'] });
        continue;
      }
    }

    let best: Scored | null = null;
    let bestAdj = -Infinity;
    for (const s of remaining) {
      let adj = s.score;
      const recent = out.slice(-cfg.diversity.sameRestaurantWindow);
      if (s.candidate.restaurantId && recent.some((o) => o.candidate.restaurantId === s.candidate.restaurantId)) adj -= cfg.diversity.sameRestaurantPenalty;
      const recentCuisine = out.slice(-cfg.diversity.sameCuisineWindow);
      if (recentCuisine.length === cfg.diversity.sameCuisineWindow && recentCuisine.every((o) => cuisineOf(o.candidate) === cuisineOf(s.candidate))) {
        adj -= cfg.diversity.sameCuisinePenalty;
      }
      if (adj > bestAdj) { bestAdj = adj; best = s; }
    }
    if (!best) break;
    remaining.delete(best);
    out.push(best);
  }
  return out;
}

/** Small seeded PRNG (mulberry32) for reproducible exploration in tests and offline evaluation. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Collaborative score per candidate: the strongest similarity between the candidate and any video the
 * user recently responded to positively (crave, like, order). Max-aggregation keeps it in [0, 1].
 */
export function collaborativeScores(
  positiveVideoIds: Iterable<string>,
  similarities: { videoId: string; similarVideoId: string; score: number }[],
): Map<string, number> {
  const positives = new Set(positiveVideoIds);
  const out = new Map<string, number>();
  for (const s of similarities) {
    if (!positives.has(s.videoId) || positives.has(s.similarVideoId)) continue;
    out.set(s.similarVideoId, Math.max(out.get(s.similarVideoId) ?? 0, Math.min(1, s.score)));
  }
  return out;
}
