import type { DataStore } from './store';

/**
 * Small in-memory TTL cache with in-flight de-duplication (concurrent misses for the same key share
 * one database call). Per API instance; fine for a single Starter instance — move to Redis if we
 * run several. Only for data that is the same for every viewer.
 */
export class TtlCache<V> {
  private map = new Map<string, { at: number; value: Promise<V> }>();
  constructor(private ttlMs: number, private maxEntries = 500, private now: () => number = Date.now) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.map.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.map.set(key, { at: this.now(), value });
    value.catch(() => this.map.delete(key)); // never cache failures
    if (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
    return value;
  }

  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

const round = (n: number | undefined, dp: number) => (n == null ? '' : n.toFixed(dp));

/**
 * Wraps the data store so the shared, expensive reads are cached:
 *  - feed candidates (the video pool near a location; ~1 km grid, 60 s) — ranking stays per user,
 *  - menu item detail (60 s) and restaurant search results (30 s).
 * Everything user-specific (likes, follows, orders, taste profile) still goes to the database.
 */
export function withReadCache(store: DataStore, opts: { feedTtlMs?: number; menuTtlMs?: number; searchTtlMs?: number; now?: () => number } = {}): DataStore {
  const feed = new TtlCache<Awaited<ReturnType<DataStore['feedCandidates']>>>(opts.feedTtlMs ?? 60_000, 200, opts.now);
  const menu = new TtlCache<Awaited<ReturnType<DataStore['menuItemDetail']>>>(opts.menuTtlMs ?? 60_000, 2000, opts.now);
  const search = new TtlCache<Awaited<ReturnType<DataStore['nearbyRestaurants']>>>(opts.searchTtlMs ?? 30_000, 500, opts.now);
  return {
    ...store,
    feedCandidates: (q) => feed.get(
      [q.cityId ?? '', round(q.lat, 2), round(q.lng, 2), q.maxKm, q.limit].join('|'),
      () => store.feedCandidates(q),
    ),
    menuItemDetail: (id) => menu.get(id, () => store.menuItemDetail(id)),
    nearbyRestaurants: (q) => search.get(
      [round(q.lat, 2), round(q.lng, 2), q.maxKm, (q.query ?? '').trim().toLowerCase(), q.limit].join('|'),
      () => store.nearbyRestaurants(q),
    ),
  };
}
