import { describe, expect, it } from 'vitest';
import type { FeedCandidate } from '../src/feed-types';
import {
  buildTasteProfile, contextKeys, DEFAULT_RANKING_CONFIG, EMPTY_PREFERENCES, emptyProfile, mergeRankingConfig,
  rankFeed, seededRandom, type ExplicitPreferences, type Signal, type TasteProfile,
} from '../src/recommend';
import { candidateFeatures } from '../src/recommend/profile';

// --- Synthetic Brisbane catalogue -------------------------------------------------------
const NOW = new Date('2026-11-06T09:00:00Z'); // Friday 19:00 in Brisbane
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let n = 0;
function cand(name: string, o: Partial<FeedCandidate>): FeedCandidate {
  n += 1;
  return {
    videoId: `v-${name}`, playbackUrl: 'x', thumbnailUrl: null, durationMs: 15000, caption: name, hashtags: [],
    isSponsored: false, sponsorDisclosure: null, publishedAt: days(5).toISOString(), source: 'creator',
    uploaderId: 'creator-1', creatorHandle: 'c1', creatorDisplayName: 'C1',
    restaurantId: `r-${name}`, restaurantName: `R ${name}`, restaurantSlug: null, cuisines: [], priceLevel: 2,
    halalCertified: false, locationId: 'l', suburb: 'CBD', distanceKm: 2, isOpen: true, acceptingOrders: true,
    pickupEnabled: true, menuItemId: `i-${name}`, menuItemName: name, priceCents: 1800, currency: 'AUD',
    itemCuisine: 'american', itemCategory: 'burger', itemTags: [], dietaryTags: [], spiceLevel: 0, itemAvailable: true,
    orderable: true, stats: { likes: 0, comments: 0, impressions: 0, completions: 0, rightSwipes: 0, leftSwipes: 0, orders: 0 },
    ...o,
  };
}

const catalogue: FeedCandidate[] = [
  cand('salmon-nigiri', { itemCuisine: 'japanese', itemCategory: 'sushi', itemTags: ['salmon', 'seafood'], restaurantId: 'r-sushi1' }),
  cand('tuna-roll', { itemCuisine: 'japanese', itemCategory: 'sushi', itemTags: ['tuna', 'seafood'], restaurantId: 'r-sushi2' }),
  cand('chicken-don', { itemCuisine: 'japanese', itemCategory: 'rice_bowl', itemTags: ['chicken'], restaurantId: 'r-sushi1' }),
  cand('smash', { itemCuisine: 'american', itemCategory: 'burger', itemTags: ['beef'], restaurantId: 'r-burger1', halalCertified: true, dietaryTags: ['halal'] }),
  cand('chicken-burger', { itemCuisine: 'american', itemCategory: 'burger', itemTags: ['chicken'], restaurantId: 'r-burger2' }),
  cand('halal-burger-2', { itemCuisine: 'american', itemCategory: 'burger', itemTags: ['beef'], restaurantId: 'r-burger3', halalCertified: true }),
  cand('fish-tacos', { itemCuisine: 'mexican', itemCategory: 'tacos', itemTags: ['fish', 'seafood'], restaurantId: 'r-taco' }),
  cand('veg-tacos', { itemCuisine: 'mexican', itemCategory: 'tacos', itemTags: ['vegetable'], restaurantId: 'r-taco2', dietaryTags: ['vegan', 'gluten_free'] }),
  cand('prawn-curry', { itemCuisine: 'thai', itemCategory: 'curry', itemTags: ['prawn', 'seafood'], restaurantId: 'r-thai', spiceLevel: 3 }),
  cand('pad-see-ew', { itemCuisine: 'thai', itemCategory: 'noodles', itemTags: ['chicken'], restaurantId: 'r-thai' }),
  cand('cacio', { itemCuisine: 'italian', itemCategory: 'pasta', itemTags: ['cheese'], restaurantId: 'r-pasta', dietaryTags: ['vegetarian'] }),
  cand('dumplings', { itemCuisine: 'chinese', itemCategory: 'dumplings', itemTags: ['pork'], restaurantId: 'r-dump' }),
  cand('bombolini', { itemCuisine: 'desserts', itemCategory: 'dessert', itemTags: ['pastry'], restaurantId: 'r-sweet', dietaryTags: ['vegetarian'], priceCents: 1200 }),
  cand('closed-pho', { itemCuisine: 'vietnamese', itemCategory: 'noodles', itemTags: ['beef'], restaurantId: 'r-pho', orderable: false, isOpen: false }),
  cand('untagged', { menuItemId: null, menuItemName: null, priceCents: null, itemCuisine: null, itemCategory: null, restaurantId: null }),
];
const byId = (id: string) => catalogue.find((c) => c.videoId === `v-${id}`)!;

const sig = (kind: Signal['kind'], id: string, at = days(1), extra: Partial<Signal> = {}): Signal => {
  const c = byId(id);
  return { kind, at, videoId: c.videoId, menuItemId: c.menuItemId, item: candidateFeatures(c), ...extra };
};

function rank(profile: TasteProfile, prefs: ExplicitPreferences = EMPTY_PREFERENCES, personalised = true, now = NOW, limit = catalogue.length) {
  return rankFeed({ candidates: catalogue, profile, preferences: prefs, personalised, now, limit, random: seededRandom(42) });
}
const positionOf = (list: ReturnType<typeof rank>, id: string) => list.findIndex((s) => s.candidate.videoId === `v-${id}`);
const profileFrom = (signals: Signal[], extra: Partial<Parameters<typeof buildTasteProfile>[0]> = {}) =>
  buildTasteProfile({ signals, now: NOW, ...extra });

// --- Tests ------------------------------------------------------------------------------------
describe('cold start', () => {
  it('ranks without history using orderability, popularity, freshness and distance', () => {
    const list = rank(emptyProfile());
    expect(list).toHaveLength(catalogue.length);
    // Not-orderable content sinks below orderable content.
    expect(positionOf(list, 'closed-pho')).toBeGreaterThan(positionOf(list, 'smash'));
    expect(positionOf(list, 'untagged')).toBeGreaterThan(5);
  });

  it('popular content rises for new users', () => {
    const popular = catalogue.map((c) => (c.videoId === 'v-dumplings' ? { ...c, stats: { ...c.stats, impressions: 100, rightSwipes: 40, orders: 10 } } : c));
    const list = rankFeed({ candidates: popular, profile: emptyProfile(), preferences: EMPTY_PREFERENCES, personalised: true, now: NOW, limit: 5, random: seededRandom(1) });
    expect(list[0]!.candidate.videoId).toBe('v-dumplings');
    expect(list[0]!.reasons).toContain('Popular in Brisbane right now');
  });
});

describe('Smart Swipe signals', () => {
  it('right swipes on sushi move Japanese food up, with an explanation', () => {
    const scoreOf = (list: ReturnType<typeof rank>, id: string) => list.find((s) => s.candidate.videoId === `v-${id}`)!.score;
    const cold = rank(emptyProfile());
    const p = profileFrom([sig('right_swipe', 'salmon-nigiri'), sig('right_swipe', 'chicken-don')]);
    const list = rank(p);
    expect(scoreOf(list, 'tuna-roll')).toBeGreaterThan(scoreOf(cold, 'tuna-roll'));
    expect(positionOf(list, 'tuna-roll')).toBeLessThan(positionOf(list, 'chicken-burger'));
    expect(list.find((s) => s.candidate.videoId === 'v-tuna-roll')!.reasons.join(' ')).toMatch(/Japanese|Sushi/);
  });

  it('a left swipe hides that exact video but does not exclude the category', () => {
    const p = profileFrom([sig('left_swipe', 'fish-tacos')]);
    const list = rank(p);
    expect(positionOf(list, 'fish-tacos')).toBe(-1);
    expect(positionOf(list, 'veg-tacos')).toBeGreaterThanOrEqual(0);
    expect(positionOf(list, 'prawn-curry')).toBeGreaterThanOrEqual(0);
    expect(p.affinities.get('tag:seafood')!).toBeGreaterThan(DEFAULT_RANKING_CONFIG.minAffinity);
  });

  it('repeated seafood rejections gradually reduce similar recommendations, never below the floor', () => {
    const prawnScore = (k: number) => {
      const signals = Array.from({ length: k }, (_, i) => sig('left_swipe', ['fish-tacos', 'salmon-nigiri', 'tuna-roll'][i % 3]!, days(1 + i)));
      return rank(profileFrom(signals)).find((s) => s.candidate.videoId === 'v-prawn-curry')!.score;
    };
    const s0 = prawnScore(0), s1 = prawnScore(1), s3 = prawnScore(3), s6 = prawnScore(6);
    expect(s1).toBeLessThan(s0);
    expect(s3).toBeLessThan(s1);
    expect(s6).toBeLessThan(s3);
    const heavy = profileFrom(Array.from({ length: 30 }, (_, i) => sig('left_swipe', 'fish-tacos', days(1 + i * 0.1))));
    expect(heavy.affinities.get('tag:seafood')).toBe(DEFAULT_RANKING_CONFIG.minAffinity);
    expect(positionOf(rank(heavy), 'prawn-curry')).toBeGreaterThanOrEqual(0); // still eligible
  });

  it('a quick skip is a much weaker signal than an explicit left swipe', () => {
    const skip = profileFrom([sig('watch', 'dumplings', days(1), { watchMs: 900, completionPct: 6 })]);
    const left = profileFrom([sig('left_swipe', 'dumplings')]);
    const s = skip.affinities.get('cuisine:chinese')!;
    const l = left.affinities.get('cuisine:chinese')!;
    expect(s).toBeLessThan(0);
    expect(Math.abs(s)).toBeLessThan(Math.abs(l) / 4);
  });

  it('ordinary viewing (neither quick skip nor long watch) is neutral', () => {
    const p = profileFrom([sig('watch', 'dumplings', days(1), { watchMs: 5000, completionPct: 35 })]);
    expect(p.affinities.size).toBe(0);
  });
});

describe('purchases', () => {
  it('a completed order outweighs several long watches', () => {
    const watched = profileFrom([1, 2, 3].map((d) => sig('watch', 'cacio', days(d), { watchMs: 15000, completionPct: 100 })));
    const ordered = profileFrom([sig('order', 'cacio')]);
    expect(ordered.affinities.get('cuisine:italian')!).toBeGreaterThan(watched.affinities.get('cuisine:italian')!);
  });

  it('repeat orders count more than the first order', () => {
    const once = profileFrom([sig('order', 'smash', days(3))]);
    const twice = profileFrom([sig('order', 'smash', days(3)), sig('order', 'smash', days(2))]);
    const gainFirst = once.affinities.get(`restaurant:r-burger1`)!;
    const gainSecond = twice.affinities.get(`restaurant:r-burger1`)! - gainFirst;
    expect(twice.affinities.get('restaurant:r-burger1')!).toBeGreaterThan(gainFirst);
    expect(gainSecond).toBeGreaterThan(0);
  });

  it('learns typical spend for price compatibility', () => {
    const p = profileFrom([sig('order', 'bombolini'), sig('order', 'bombolini', days(2)), sig('order', 'smash', days(3))]);
    expect(p.typicalSpendCents).toBe(1200);
  });

  it('frequent halal-certified burger orders surface other verified halal options', () => {
    const p = profileFrom([sig('order', 'smash', days(1)), sig('order', 'smash', days(8)), sig('order', 'smash', days(15))]);
    const list = rank(p);
    expect(positionOf(list, 'halal-burger-2')).toBeLessThan(positionOf(list, 'chicken-burger'));
    // ...but behaviour never becomes a hard dietary filter.
    expect(positionOf(list, 'chicken-burger')).toBeGreaterThanOrEqual(0);
    expect(positionOf(list, 'dumplings')).toBeGreaterThanOrEqual(0);
  });
});

describe('time-of-week habits', () => {
  it('maps Brisbane local time correctly (UTC+10, no DST)', () => {
    expect(contextKeys(NOW)).toEqual(['ctx:fri_evening', 'ctx:evening']);
    expect(contextKeys(new Date('2026-11-03T02:00:00Z'))).toEqual(['ctx:tue_lunch', 'ctx:lunch']);
  });

  it('sushi ordered on Friday evenings gets a boost on Friday evening only', () => {
    const fridays = [7, 14, 21].map((d) => sig('order', 'salmon-nigiri', days(d)));
    const p = profileFrom(fridays);
    const fri = rank(p, EMPTY_PREFERENCES, true, NOW).find((s) => s.candidate.videoId === 'v-tuna-roll')!;
    const tueLunch = new Date('2026-11-03T02:00:00Z');
    const tue = rank(profileFrom(fridays.map((s) => ({ ...s, at: new Date(s.at) })), {}), EMPTY_PREFERENCES, true, tueLunch)
      .find((s) => s.candidate.videoId === 'v-tuna-roll')!;
    expect(fri.parts.context ?? 0).toBeGreaterThan(0);
    expect(tue.parts.context ?? 0).toBe(0);
    expect(fri.reasons.join(' ')).toMatch(/usual Japanese time/);
  });
});

describe('explicit preferences', () => {
  it('dietary requirements are hard filters only when the user sets them', () => {
    const list = rank(emptyProfile(), { ...EMPTY_PREFERENCES, dietaryRequirements: ['vegetarian'] });
    const ids = list.map((s) => s.candidate.videoId).sort();
    expect(ids).toEqual(['v-bombolini', 'v-cacio', 'v-veg-tacos']); // vegan counts as vegetarian; unverifiable content excluded
  });

  it('halal requirement accepts declared halal items or certified restaurants', () => {
    const list = rank(emptyProfile(), { ...EMPTY_PREFERENCES, dietaryRequirements: ['halal'] });
    expect(list.map((s) => s.candidate.videoId).sort()).toEqual(['v-halal-burger-2', 'v-smash']);
  });

  it('favourite and disliked cuisines shift ranking', () => {
    const fav = rank(emptyProfile(), { ...EMPTY_PREFERENCES, favouriteCuisines: ['thai'] });
    const dis = rank(emptyProfile(), { ...EMPTY_PREFERENCES, dislikedCuisines: ['thai'] });
    expect(positionOf(fav, 'pad-see-ew')).toBeLessThan(positionOf(dis, 'pad-see-ew'));
  });

  it('spice preference demotes much hotter dishes', () => {
    const mild = rank(emptyProfile(), { ...EMPTY_PREFERENCES, spicePreference: 0 }).find((s) => s.candidate.videoId === 'v-prawn-curry')!;
    expect(mild.parts.spiceMismatch).toBeLessThan(0);
  });
});

describe('privacy', () => {
  it('without personalisation consent, behavioural history is ignored', () => {
    const p = profileFrom([sig('right_swipe', 'salmon-nigiri'), sig('left_swipe', 'fish-tacos')]);
    const off = rank(p, EMPTY_PREFERENCES, false).map((s) => s.candidate.videoId);
    const cold = rank(emptyProfile(), EMPTY_PREFERENCES, false).map((s) => s.candidate.videoId);
    expect(off).toEqual(cold);
    expect(off).toContain('v-fish-tacos'); // not even hidden — we don't use their swipe history
  });

  it('Reset My Taste Profile: signals before the reset are ignored', () => {
    const p = profileFrom([sig('right_swipe', 'salmon-nigiri', days(5))], { resetAt: days(2) });
    expect(p.affinities.size).toBe(0);
    expect(p.signalCount).toBe(0);
  });

  it('older signals decay', () => {
    const recent = profileFrom([sig('right_swipe', 'cacio', days(1))]).affinities.get('cuisine:italian')!;
    const old = profileFrom([sig('right_swipe', 'cacio', days(90))]).affinities.get('cuisine:italian')!;
    expect(old).toBeLessThan(recent / 4);
  });
});

describe('exploration and diversity', () => {
  it('reserves exploration slots for unfamiliar cuisines', () => {
    const p = profileFrom([1, 2, 3, 4].map((d) => sig('right_swipe', 'salmon-nigiri', days(d))));
    const list = rank(p);
    const explore = list.filter((s) => s.exploration);
    expect(explore.length).toBeGreaterThan(0);
    for (const e of explore) {
      expect(e.candidate.itemCuisine).not.toBe('japanese');
      expect(e.reasons).toEqual(['Something different to try']);
    }
    expect(list[DEFAULT_RANKING_CONFIG.exploration.offset]!.exploration).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = rank(emptyProfile()).map((s) => s.candidate.videoId);
    const b = rank(emptyProfile()).map((s) => s.candidate.videoId);
    expect(a).toEqual(b);
  });

  it('avoids the same restaurant back-to-back when alternatives exist', () => {
    const p = profileFrom([sig('order', 'chicken-don'), sig('order', 'salmon-nigiri', days(2))]);
    const list = rank(p).filter((s) => s.candidate.restaurantId);
    for (let i = 1; i < 6; i++) expect(list[i]!.candidate.restaurantId).not.toBe(list[i - 1]!.candidate.restaurantId);
  });
});

describe('configuration', () => {
  it('applies admin overrides and ignores invalid values', () => {
    const { config, ignored } = mergeRankingConfig({ signals: { rightSwipe: 5, leftSwipe: 'lots' }, nope: 1, score: { trending: Infinity } });
    expect(config.signals.rightSwipe).toBe(5);
    expect(config.signals.leftSwipe).toBe(DEFAULT_RANKING_CONFIG.signals.leftSwipe);
    expect(config.score.trending).toBe(DEFAULT_RANKING_CONFIG.score.trending);
    expect(ignored.sort()).toEqual(['nope', 'score.trending', 'signals.leftSwipe']);
  });

  it('weights actually change outcomes', () => {
    const { config } = mergeRankingConfig({ score: { orderable: 0, notOrderable: 0, trending: 0, freshness: 0, distancePerKm: 0 } });
    const list = rankFeed({ candidates: catalogue, profile: emptyProfile(), preferences: EMPTY_PREFERENCES, personalised: true, now: NOW, limit: 20, random: seededRandom(3) }, config);
    expect(list.every((s) => Math.abs(s.score) < 1e-9)).toBe(true);
  });
});
