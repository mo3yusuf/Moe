import type { FeedItem, FeedResponse } from '@crave/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { DEMO_FEED } from './demo-data';
import { getCoarseLocation } from './location';

export interface FeedEntry extends FeedItem { feedRequestId: string | null }

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
      const loc = await getCoarseLocation();
      const shown = itemsRef.current.map((i) => i.videoId).slice(-150).join(',');
      const params = new URLSearchParams({ lat: String(loc.lat), lng: String(loc.lng), limit: '10', mode });
      if (shown) params.set('exclude', shown);
      const res = await api<FeedResponse>(`/v1/feed?${params}`);
      setPersonalised(res.personalised);
      if (res.items.length === 0) exhausted.current = true;
      setItems((prev) => [...prev, ...res.items.map((i) => ({ ...i, feedRequestId: res.feedRequestId }))]);
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

  useEffect(() => { exhausted.current = false; itemsRef.current = []; setItems([]); void loadMore(); }, [loadMore]);

  return { items, loading, error, personalised, loadMore, refresh, patch };
}
