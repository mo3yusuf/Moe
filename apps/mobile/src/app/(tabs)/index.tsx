import Ionicons from '@expo/vector-icons/Ionicons';
import type { SwipeDirection } from '@crave/core';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, AppState, FlatList, Pressable, Share, StyleSheet, View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, DemoBanner, T } from '@/components/ui';
import { track, watchSession } from '@/features/feed/events';
import { FeedVideo, type InputMethod } from '@/features/feed/FeedVideo';
import { useFeed, type FeedEntry } from '@/features/feed/use-feed';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, font, HIT, space } from '@/theme/tokens';

const PRELOAD_AHEAD = 1;

export default function ForYou() {
  const insets = useSafeAreaInsets();
  const tabFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const listRef = useRef<FlatList<FeedEntry>>(null);
  const router = useRouter();
  const [mode, setMode] = useState<'for_you' | 'following'>('for_you');
  const { items, loading, error, personalised, loadMore, refresh, patch } = useFeed(mode);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (config.demoMode || !tabFocused) return;
    api<{ profile: { onboardingCompletedAt: string | null } }>('/v1/me')
      .then((me) => setNeedsOnboarding(!me.profile.onboardingCompletedAt))
      .catch(() => {});
  }, [tabFocused]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sr = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { sub.remove(); sr.remove(); };
  }, []);

  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  useEffect(() => {
    if (items.length && activeIndex >= items.length - 3) void loadMore();
  }, [activeIndex, items.length, loadMore]);

  const scrollTo = useCallback((index: number) => {
    if (index < 0 || index >= items.length) return;
    listRef.current?.scrollToIndex({ index, animated: true });
    setActiveIndex(index);
  }, [items.length]);

  const onSwipe = useCallback((item: FeedEntry, direction: SwipeDirection, method: InputMethod) => {
    const meta = { menuItemId: item.menuItem?.id ?? null, feedRequestId: item.feedRequestId };
    track(watchSession.swipe(item.videoId, direction, method, meta));
    patch(item.videoId, { craved: direction === 'right' });
    if (direction === 'left') {
      // Not for me: move on so the user isn't left looking at it.
      const index = items.findIndex((i) => i.videoId === item.videoId);
      setTimeout(() => scrollTo(index + 1), 450);
    }
  }, [items, patch, scrollTo]);

  const onToggleLike = useCallback((item: FeedEntry) => {
    const liked = !item.viewer.liked;
    patch(item.videoId, { liked });
    track({ kind: 'action', action: liked ? 'like' : 'unlike', videoId: item.videoId });
  }, [patch]);

  const onToggleSave = useCallback((item: FeedEntry) => {
    const saved = !item.viewer.saved;
    patch(item.videoId, { saved });
    track({ kind: 'action', action: saved ? 'save' : 'unsave', videoId: item.videoId, menuItemId: item.menuItem?.id ?? null });
  }, [patch]);

  const onComments = useCallback((item: FeedEntry) => {
    router.push({ pathname: '/comments/[videoId]', params: { videoId: item.videoId } });
  }, [router]);

  const onFollowCreator = useCallback(async (item: FeedEntry) => {
    if (!item.creator || config.demoMode) return;
    const follow = !item.viewer.followingCreator;
    for (const i of items) if (i.creator?.id === item.creator.id) patch(i.videoId, { followingCreator: follow });
    try { await api(`/v1/creators/${item.creator.id}/follow`, { method: 'PUT', body: { follow } }); }
    catch { for (const i of items) if (i.creator?.id === item.creator.id) patch(i.videoId, { followingCreator: !follow }); }
  }, [items, patch]);

  const onShare = useCallback(async (item: FeedEntry) => {
    const what = item.menuItem ? `${item.menuItem.name} at ${item.restaurant?.name}` : item.caption ?? 'this';
    const result = await Share.share({ message: `Craving ${what} — watch it on CRAVE: crave://video/${item.videoId}` });
    if (result.action === Share.sharedAction) track({ kind: 'interaction', eventType: 'share', videoId: item.videoId, feedRequestId: item.feedRequestId });
  }, []);

  const onOrder = useCallback((item: FeedEntry) => {
    track({ kind: 'interaction', eventType: 'order_click', videoId: item.videoId, menuItemId: item.menuItem?.id ?? null, feedRequestId: item.feedRequestId });
    if (!item.menuItem) return;
    router.push({ pathname: '/item/[id]', params: { id: item.menuItem.id, video: item.videoId } });
  }, [router]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };

  const focused = tabFocused && appActive;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {size.height > 0 && items.length > 0 ? (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(i) => i.videoId}
          renderItem={({ item, index }) => (
            <FeedVideo
              item={item}
              width={size.width}
              height={size.height}
              isActive={index === activeIndex}
              preload={index > activeIndex && index <= activeIndex + PRELOAD_AHEAD || index === activeIndex - 1}
              focused={focused}
              bottomInset={space.md}
              orderingEnabled={!config.demoMode}
              onSwipe={onSwipe}
              onToggleLike={onToggleLike}
              onToggleSave={onToggleSave}
              onShare={onShare}
              onOrder={onOrder}
              onComments={onComments}
              onFollowCreator={onFollowCreator}
              onNext={() => scrollTo(index + 1)}
              onPrevious={() => scrollTo(index - 1)}
            />
          )}
          pagingEnabled
          snapToInterval={size.height}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: size.height, offset: size.height * index, index })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          onEndReachedThreshold={2}
          onEndReached={() => void loadMore()}
        />
      ) : (
        <View style={styles.empty}>
          {loading ? <ActivityIndicator color={colors.accent} size="large" /> : (
            <View style={{ gap: space.md, alignItems: 'center', paddingHorizontal: space.xl }}>
              <T variant="heading">{error ? 'Couldn’t load your feed' : mode === 'following' ? 'Nothing from accounts you follow yet' : 'No videos nearby yet'}</T>
              {!error && mode === 'following' ? <T muted style={{ textAlign: 'center' }}>Follow restaurants and creators to see their latest videos here.</T> : null}
              {error ? <T muted style={{ textAlign: 'center' }}>{error}</T> : null}
              <Button title="Try again" onPress={() => void refresh()} />
            </View>
          )}
        </View>
      )}

      {/* Header overlay */}
      <View style={[styles.header, { paddingTop: insets.top }]} pointerEvents="box-none">
        {config.demoMode ? <DemoBanner /> : null}
        <View style={styles.headerRow} pointerEvents="box-none">
          {(['following', 'for_you'] as const).map((m) => (
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setActiveIndex(0); }} hitSlop={8}>
              <T variant="heading" style={[styles.headerTitle, { opacity: mode === m ? 1 : 0.55 }]}>{m === 'for_you' ? 'For You' : 'Following'}</T>
            </Pressable>
          ))}
          {personalised ? <T variant="label" style={styles.badge}>PERSONALISED</T> : null}
        </View>
        {needsOnboarding ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/preferences')} style={styles.onboard}>
            <T variant="small" style={{ fontWeight: '700' }}>New here? Tell us what you crave →</T>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} onPress={() => setNeedsOnboarding(false)}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </Pressable>
        ) : null}
        {screenReader ? (
          <View style={styles.srNav}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous video" onPress={() => scrollTo(activeIndex - 1)} style={styles.srBtn}>
              <Ionicons name="chevron-up" size={24} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next video" onPress={() => scrollTo(activeIndex + 1)} style={styles.srBtn}>
              <Ionicons name="chevron-down" size={24} color={colors.text} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.sm },
  headerTitle: { ...font.heading, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  badge: { color: colors.accent },
  onboard: { marginHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: space.lg, minHeight: HIT },
  srNav: { position: 'absolute', right: space.sm, top: 80, gap: space.sm },
  srBtn: { width: HIT, height: HIT, borderRadius: HIT / 2, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
});
