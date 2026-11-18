import type { FeedItem, FeedResponse } from '@crave/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { DEMO_FEED } from './demo-data';
import { getCoarseLocation } from './location';

export interface FeedEntry extends FeedItem { feedRequestId: string | null }

// The last feed page is kept on the phone (web: localStorage) so the next visit can start playing
// immediately while a fresh page loads behind it.
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const cacheKey = (mode: string) => `crave.feed.v1.${mode}`;
function readCachedFeed(mode: string): FeedEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = JSON.parse(localStorage.getItem(cacheKey(mode)) ?? 'null') as { at: number; items: FeedEntry[] } | null;
    if (!raw || Date.now() - raw.at > CACHE_MAX_AGE_MS) return [];
    return raw.items.map((i) => ({ ...i, feedRequestId: null })); // not attributed to a new ranking request
  } catch { return []; }
}
function writeCachedFeed(mode: string, items: FeedEntry[]) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(cacheKey(mode), JSON.stringify({ at: Date.now(), items: items.slice(0, 6) })); } catch { /* full or blocked */ }
}

// The first page is requested as soon as the app starts (see prefetchFeed, called from the root
// layout), in parallel with drawing the screens, instead of after the feed screen has mounted.
let prefetched: { mode: string; at: number; promise: Promise<FeedResponse> } | null = null;

async function requestPage(mode: string, exclude: string[]): Promise<FeedResponse> {
  const loc = await getCoarseLocation();
  const params = new URLSearchParams({ lat: String(loc.lat), lng: String(loc.lng), limit: '10', mode });
  if (exclude.length) params.set('exclude', exclude.slice(-150).join(','));
  return api<FeedResponse>(`/v1/feed?${params}`);
}

/** Start loading the first For You page right away (no-op in demo mode). */
export function prefetchFeed(mode: 'for_you' | 'following' = 'for_you') {
  if (config.demoMode || prefetched) return;
  const promise = requestPage(mode, readCachedFeed(mode).map((i) => i.videoId));
  promise.catch(() => { prefetched = null; }); // e.g. not signed in yet: the screen fetches normally
  prefetched = { mode, at: Date.now(), promise };
}

/** Loads ranked feed pages from the API (or demo data), excluding videos already shown this session. */
export function useFeed(mode: 'for_you' | 'following' = 'for_you') {
  const [items, setItems] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [personalised, setPersonalised] = useState(false);
  const loadingRef = useRef(false);
  const exhausted = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || exhausted.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      if (config.demoMode) {
        setItems(DEMO_FEED.map((i) => ({ ...i, feedRequestId: null })));
        exhausted.current = true;
        return;
      }
      const shown = itemsRef.current.map((i) => i.videoId);
      // Use the request started at app launch if it's for this screen's first page and still fresh.
      const early = prefetched && prefetched.mode === mode && Date.now() - prefetched.at < 30_000
        && itemsRef.current.every((i) => i.feedRequestId === null) ? prefetched.promise : null;
      prefetched = null;
      const res = await (early ?? requestPage(mode, shown)).catch(() => requestPage(mode, shown));
      setPersonalised(res.personalised);
      if (res.items.length === 0) exhausted.current = true;
      const fresh = res.items.map((i) => ({ ...i, feedRequestId: res.feedRequestId }));
      if (itemsRef.current.length === 0 || itemsRef.current.every((i) => i.feedRequestId === null)) writeCachedFeed(mode, fresh);
      setItems((prev) => [...prev, ...fresh.filter((f) => !prev.some((p) => p.videoId === f.videoId))]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the feed');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [mode]);

  const itemsRef = useRef<FeedEntry[]>([]);
  itemsRef.current = items;

  const refresh = useCallback(async () => {
    exhausted.current = false;
    setItems([]);
    itemsRef.current = [];
    await loadMore();
  }, [loadMore]);

  const patch = useCallback((videoId: string, change: Partial<FeedEntry['viewer']>) => {
    setItems((prev) => prev.map((i) => (i.videoId === videoId ? { ...i, viewer: { ...i.viewer, ...change } } : i)));
  }, []);

  useEffect(() => {
    exhausted.current = false;
    // Show the remembered feed instantly (first video starts without waiting for the network), then
    // fetch a fresh page that continues after it.
    const cached = config.demoMode ? [] : readCachedFeed(mode);
    itemsRef.current = cached;
    setItems(cached);
    if (cached.length) setLoading(false);
    void loadMore();
  }, [loadMore, mode]);

  return { items, loading, error, personalised, loadMore, refresh, patch };
}
