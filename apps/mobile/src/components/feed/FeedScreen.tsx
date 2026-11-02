import { FeedSessionTracker } from '@crave/core';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Share, StyleSheet, Text, View, type ListViewToken as ViewToken } from 'react-native';
import { fetchFeed, type FeedItem as FeedItemData, type FeedKind } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { events, newId } from '@/lib/events';
import type { CoarseLocation } from '@/lib/location';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { colors, space, type } from '@/theme';
import { FeedItem, type WatchReport } from './FeedItem';
import { Toast, type ToastMessage } from './Toast';

const PAGE = 6;

/**
 * Vertical, full-screen paging feed. Only the active video and its neighbours
 * hold a loaded player (preloading the next clip while keeping memory flat).
 */
export function FeedScreen({ kind, location, emptyTitle, emptyBody }: { kind: FeedKind; location: CoarseLocation; emptyTitle: string; emptyBody: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = !!session;
  const [height, setHeight] = useState(0);
  const [items, setItems] = useState<FeedItemData[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'end'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(Platform.OS === 'web'); // browsers block autoplay with sound
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [following, setFollowing] = useState<Record<string, boolean>>({});

  const sessionId = useRef(newId());
  const seen = useRef<string[]>([]);
  const loading = useRef(false);
  const tracker = useRef(new FeedSessionTracker());
  const listRef = useRef<FlatList<FeedItemData>>(null);

  const notify = (text: string, icon: ToastMessage['icon']) => setToast({ id: Date.now(), text, icon });

  const loadMore = useCallback(async (reset = false) => {
    if (loading.current) return;
    loading.current = true;
    try {
      if (reset) {
        sessionId.current = newId();
        seen.current = [];
        tracker.current.reset();
      }
      const res = await fetchFeed({ kind, session: sessionId.current, limit: PAGE, exclude: seen.current, lat: location.lat, lng: location.lng });
      seen.current.push(...res.items.map((i) => i.videoId));
      setItems((prev) => (reset ? res.items : [...prev, ...res.items.filter((i) => !prev.some((p) => p.videoId === i.videoId))]));
      setLiked((prev) => ({ ...Object.fromEntries(res.items.map((i) => [i.videoId, i.viewer.liked])), ...(reset ? {} : prev) }));
      setSaved((prev) => ({ ...Object.fromEntries(res.items.map((i) => [i.videoId, i.viewer.saved])), ...(reset ? {} : prev) }));
      setFollowing((prev) => ({ ...Object.fromEntries(res.items.map((i) => [i.uploader.id, i.viewer.followsUploader])), ...(reset ? {} : prev) }));
      setStatus(res.items.length < PAGE ? 'end' : 'ready');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load videos');
      setStatus('error');
    } finally {
      loading.current = false;
    }
  }, [kind, location.lat, location.lng]);

  useEffect(() => {
    setStatus('loading');
    setActive(0);
    void loadMore(true);
  }, [loadMore, signedIn]);

  // ---------------------------------------------------------------- tracking
  const onWatchReport = useCallback((item: FeedItemData, r: WatchReport) => {
    // Swiping back to a previous video must not create a second preference signal.
    if (!tracker.current.shouldRecord(item.videoId)) return;
    events.track('watch', { videoId: item.videoId, watchedMs: r.watchedMs, durationMs: r.durationMs, loops: r.loops, feedSessionId: sessionId.current });
  }, []);

  const requireAccount = (why: string) => {
    if (signedIn) return true;
    notify(why, 'information-circle');
    router.push('/sign-in');
    return false;
  };

  // ---------------------------------------------------------------- actions
  const onSwipe = useCallback((item: FeedItemData, decision: 'crave' | 'not_for_me') => {
    void Haptics.impactAsync(decision === 'crave' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (decision === 'crave') {
      if (!requireAccount('Sign in to save Cravings')) return;
      tracker.current.shouldRecord(item.videoId); // explicit signal supersedes the passive watch signal
      setSaved((s) => ({ ...s, [item.videoId]: true }));
      events.track('crave_swipe', { videoId: item.videoId, menuItemId: item.meal?.menuItemId, feedSessionId: sessionId.current });
      notify('Saved to Cravings', 'flame');
    } else {
      tracker.current.shouldRecord(item.videoId);
      if (signedIn) events.track('not_for_me_swipe', { videoId: item.videoId, menuItemId: item.meal?.menuItemId, feedSessionId: sessionId.current });
      notify('Got it — fewer like this', 'eye-off');
      // Remove the video; the next one slides into place.
      setTimeout(() => setItems((prev) => prev.filter((i) => i.videoId !== item.videoId)), 230);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const onLike = useCallback((item: FeedItemData) => {
    if (!requireAccount('Sign in to like videos')) return;
    const next = !liked[item.videoId];
    setLiked((l) => ({ ...l, [item.videoId]: next }));
    events.track(next ? 'like' : 'unlike', { videoId: item.videoId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, liked]);

  const onSave = useCallback((item: FeedItemData) => {
    if (!requireAccount('Sign in to save meals')) return;
    const next = !saved[item.videoId];
    setSaved((s) => ({ ...s, [item.videoId]: next }));
    events.track(next ? 'save_meal' : 'unsave_meal', { videoId: item.videoId, menuItemId: item.meal?.menuItemId });
    if (next) notify('Saved to Cravings', 'flame');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, saved]);

  const onFollow = useCallback(async (item: FeedItemData) => {
    if (!requireAccount('Sign in to follow creators') || !supabase || !session) return;
    const now = !following[item.uploader.id];
    setFollowing((f) => ({ ...f, [item.uploader.id]: now }));
    const res = now
      ? await supabase.from('user_follows').insert({ follower_id: session.user.id, followee_id: item.uploader.id })
      : await supabase.from('user_follows').delete().match({ follower_id: session.user.id, followee_id: item.uploader.id });
    if (res.error && res.error.code !== '23505') {
      setFollowing((f) => ({ ...f, [item.uploader.id]: !now }));
      notify('Could not update follow', 'information-circle');
    } else if (now) {
      events.track('follow_creator', { videoId: item.videoId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, following, session]);

  const onShare = useCallback(async (item: FeedItemData) => {
    try {
      const what = item.meal ? `${item.meal.name}${item.restaurant ? ` at ${item.restaurant.name}` : ''}` : item.caption;
      const result = await Share.share({ message: `${what} — watch it on CRAVE: crave://video/${item.videoId}` });
      if (result.action === Share.sharedAction && signedIn) events.track('share', { videoId: item.videoId });
    } catch {
      /* user cancelled */
    }
  }, [signedIn]);

  const onOrder = useCallback((item: FeedItemData) => {
    if (!item.meal) return;
    if (signedIn) events.track('menu_item_click', { videoId: item.videoId, menuItemId: item.meal.menuItemId, restaurantId: item.restaurant?.id });
    router.push({ pathname: '/meal/[id]', params: { id: item.meal.menuItemId, video: item.videoId } });
  }, [router, signedIn]);

  const onComments = useCallback((item: FeedItemData) => {
    router.push({ pathname: '/comments/[videoId]', params: { videoId: item.videoId } });
  }, [router]);

  const onOpenRestaurant = useCallback((item: FeedItemData) => {
    if (item.restaurant) router.push({ pathname: '/restaurant/[id]', params: { id: item.restaurant.id } });
  }, [router]);

  // ---------------------------------------------------------------- paging
  const viewability = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index !== null && first?.index !== undefined) setActive(first.index);
  }).current;

  const renderItem = useCallback(({ item, index }: { item: FeedItemData; index: number }) => (
    <FeedItem
      item={item}
      height={height}
      isActive={index === active}
      shouldLoad={Math.abs(index - active) <= 1}
      muted={muted}
      liked={!!liked[item.videoId]}
      saved={!!saved[item.videoId]}
      followsUploader={!!following[item.uploader.id]}
      onToggleMute={() => setMuted((m) => !m)}
      onSwipe={onSwipe}
      onLike={onLike}
      onSave={onSave}
      onShare={onShare}
      onComments={onComments}
      onFollow={onFollow}
      onOrder={onOrder}
      onOpenRestaurant={onOpenRestaurant}
      onWatchReport={onWatchReport}
    />
  ), [height, active, muted, liked, saved, following, onSwipe, onLike, onSave, onShare, onComments, onFollow, onOrder, onOpenRestaurant, onWatchReport]);

  const getItemLayout = useMemo(() => (_: unknown, index: number) => ({ length: height, offset: height * index, index }), [height]);

  return (
    <View style={styles.root} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {height > 0 && items.length > 0 ? (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(i) => i.videoId}
          renderItem={renderItem}
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewability}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews={Platform.OS === 'android'}
          onEndReachedThreshold={2}
          onEndReached={() => status === 'ready' && void loadMore()}
          accessibilityLabel="Food video feed"
        />
      ) : null}

      {status === 'loading' && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : null}

      {status === 'error' && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.title}>Couldn’t load the feed</Text>
          <Text style={styles.body}>{error}</Text>
          <Button label="Try again" onPress={() => { setStatus('loading'); void loadMore(true); }} style={{ marginTop: space.lg }} />
        </View>
      ) : null}

      {status !== 'loading' && status !== 'error' && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.title}>{emptyTitle}</Text>
          <Text style={styles.body}>{emptyBody}</Text>
        </View>
      ) : null}

      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
});
