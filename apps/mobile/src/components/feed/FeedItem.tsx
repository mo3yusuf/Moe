import { DEFAULT_SWIPE_THRESHOLDS, classifyHorizontalSwipe, type SwipeDecision } from '@crave/core';
import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { FeedItem as FeedItemData } from '@/lib/api';
import { colors, radius, space, type } from '@/theme';
import { compactCount, formatAud } from './format';
import { RailButton } from './RailButton';

export interface WatchReport {
  watchedMs: number;
  durationMs: number;
  loops: number;
}

interface Props {
  item: FeedItemData;
  height: number;
  isActive: boolean;
  /** Load (and buffer) the video: active item and its neighbours. */
  shouldLoad: boolean;
  muted: boolean;
  liked: boolean;
  saved: boolean;
  followsUploader: boolean;
  onToggleMute: () => void;
  onSwipe: (item: FeedItemData, decision: Exclude<SwipeDecision, 'none'>) => void;
  onLike: (item: FeedItemData) => void;
  onSave: (item: FeedItemData) => void;
  onShare: (item: FeedItemData) => void;
  onComments: (item: FeedItemData) => void;
  onFollow: (item: FeedItemData) => void;
  onOrder: (item: FeedItemData) => void;
  onOpenRestaurant: (item: FeedItemData) => void;
  onWatchReport: (item: FeedItemData, report: WatchReport) => void;
}

function FeedItemComponent(props: Props) {
  const { item, height, isActive, shouldLoad, muted } = props;
  const { width } = useWindowDimensions();
  const [paused, setPaused] = useState(false);

  // ---------------------------------------------------------------- video
  const source = shouldLoad && item.playbackUrl ? { uri: item.playbackUrl, useCaching: true } : null;
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = muted;
    p.timeUpdateEventInterval = 0;
  });
  const loops = useRef(0);
  const activeSince = useRef<number | null>(null);
  const watched = useRef(0);

  useEventListener(player, 'playToEnd', () => {
    loops.current += 1;
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (isActive && !paused) {
      player.play();
      activeSince.current = Date.now();
    } else {
      player.pause();
      if (activeSince.current !== null) {
        watched.current += Date.now() - activeSince.current;
        activeSince.current = null;
      }
    }
  }, [isActive, paused, player]);

  // Report watch time when the video leaves the screen.
  useEffect(() => {
    if (isActive) return;
    if (watched.current > 0) {
      props.onWatchReport(item, {
        watchedMs: watched.current,
        durationMs: item.durationMs ?? Math.round((player.duration || 0) * 1000),
        loops: loops.current,
      });
      watched.current = 0;
      loops.current = 0;
      if (shouldLoad) player.currentTime = 0;
    }
    setPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // ---------------------------------------------------------------- swipe
  const tx = useSharedValue(0);

  function commitSwipe(translationX: number, translationY: number, velocityX: number) {
    const decision = classifyHorizontalSwipe({ translationX, translationY, velocityX, screenWidth: width });
    if (decision === 'none') {
      tx.value = withSpring(0, { damping: 18 });
      return;
    }
    if (decision === 'not_for_me') {
      tx.value = withTiming(-width * 1.3, { duration: 220 });
    } else {
      // CRAVE IT: nudge right, confirm, then settle back.
      tx.value = withSpring(0, { damping: 16 });
    }
    props.onSwipe(item, decision);
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      scheduleOnRN(commitSwipe, e.translationX, e.translationY, e.velocityX);
    });

  const togglePause = () => setPaused((p) => !p);
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success) scheduleOnRN(togglePause);
    });

  const threshold = width * DEFAULT_SWIPE_THRESHOLDS.distanceRatio;
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { rotate: `${interpolate(tx.value, [-width, 0, width], [-6, 0, 6])}deg` }],
  }));
  const craveStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, threshold], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [0, threshold], [0.8, 1.05], Extrapolation.CLAMP) }, { rotate: '-12deg' }],
  }));
  const nopeStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold, 0], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tx.value, [-threshold, 0], [1.05, 0.8], Extrapolation.CLAMP) }, { rotate: '12deg' }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(tx.value), [0, threshold], [1, 0.25], Extrapolation.CLAMP),
  }));

  // ---------------------------------------------------------------- render
  const uploaderName = item.uploader.username ? `@${item.uploader.username}` : item.uploader.displayName ?? 'CRAVE creator';
  const a11yActions = [
    { name: 'crave', label: 'Crave it — save and see more like this' },
    { name: 'notForMe', label: 'Not for me — hide this video' },
    ...(item.orderable ? [{ name: 'order', label: `Order ${item.meal?.name ?? 'this meal'}` }] : []),
    { name: 'pause', label: paused ? 'Play video' : 'Pause video' },
  ];

  return (
    <View style={[styles.page, { height }]}>
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <Animated.View
          style={[StyleSheet.absoluteFill, cardStyle]}
          accessible
          accessibilityLabel={`${item.isDemo ? 'Demo video. ' : ''}${item.caption}. ${item.meal ? `${item.meal.name}, ${formatAud(item.meal.priceCents)}` : ''}${item.restaurant ? ` at ${item.restaurant.name}` : ''}`}
          accessibilityHint="Swipe right to crave it, left if it's not for you. Use actions for more options."
          accessibilityActions={a11yActions}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'crave') props.onSwipe(item, 'crave');
            else if (e.nativeEvent.actionName === 'notForMe') props.onSwipe(item, 'not_for_me');
            else if (e.nativeEvent.actionName === 'order') props.onOrder(item);
            else if (e.nativeEvent.actionName === 'pause') setPaused((p) => !p);
          }}>
          <View style={styles.videoFallback}>
            <Ionicons name="restaurant-outline" size={48} color={colors.textDim} />
            {item.meal ? <Text style={styles.fallbackText}>{item.meal.name}</Text> : null}
          </View>
          {source ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : null}
          <LinearGradient colors={[colors.scrimTop, 'transparent']} style={styles.topScrim} pointerEvents="none" />
          <LinearGradient colors={['transparent', colors.scrimBottom]} style={styles.bottomScrim} pointerEvents="none" />

          <Animated.View style={[styles.stamp, styles.craveStamp, craveStamp]} pointerEvents="none">
            <Text style={[styles.stampText, { color: colors.accent }]}>CRAVE IT</Text>
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.nopeStamp, nopeStamp]} pointerEvents="none">
            <Text style={[styles.stampText, { color: colors.text }]}>NOT FOR ME</Text>
          </Animated.View>

          {paused ? (
            <View style={styles.pauseIcon} pointerEvents="none">
              <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {/* Overlays are siblings of the gesture area so swipes never hijack button taps. */}
      <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          {item.isDemo ? (
            <View style={styles.demoBadge} accessibilityLabel="Demo content">
              <Text style={styles.demoText}>DEMO CONTENT</Text>
            </View>
          ) : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} hitSlop={10} onPress={props.onToggleMute}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.rail} pointerEvents="box-none">
          <RailButton icon="flame" label="Crave it" count="Crave" onPress={() => props.onSwipe(item, 'crave')} active={props.saved} />
          <RailButton icon={props.liked ? 'heart' : 'heart-outline'} label="Like" count={compactCount(item.stats.likes + (props.liked && !item.viewer.liked ? 1 : 0) - (!props.liked && item.viewer.liked ? 1 : 0))} active={props.liked} onPress={() => props.onLike(item)} />
          <RailButton icon="chatbubble-ellipses-outline" label="Comments" count={compactCount(item.stats.comments)} onPress={() => props.onComments(item)} />
          <RailButton icon={props.saved ? 'bookmark' : 'bookmark-outline'} label={props.saved ? 'Saved' : 'Save'} active={props.saved} onPress={() => props.onSave(item)} />
          <RailButton icon="arrow-redo-outline" label="Share" onPress={() => props.onShare(item)} />
          <RailButton icon="close-circle-outline" label="Not for me" count="Nope" onPress={() => props.onSwipe(item, 'not_for_me')} />
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          <View style={styles.uploaderRow}>
            <Text style={styles.uploader} numberOfLines={1}>{uploaderName}</Text>
            {item.uploader.kind === 'creator' ? (
              <Pressable accessibilityRole="button" accessibilityLabel={props.followsUploader ? `Unfollow ${uploaderName}` : `Follow ${uploaderName}`} onPress={() => props.onFollow(item)} style={[styles.followBtn, props.followsUploader && styles.following]}>
                <Text style={styles.followText}>{props.followsUploader ? 'Following' : 'Follow'}</Text>
              </Pressable>
            ) : (
              <View style={styles.kindBadge}><Text style={styles.kindText}>RESTAURANT</Text></View>
            )}
          </View>
          {item.isSponsored ? <Text style={styles.sponsored}>{item.sponsorDisclosure ?? 'Sponsored'}</Text> : null}
          <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
          {item.reasons[0] ? <Text style={styles.reason}>{item.reasons[0]}</Text> : null}

          {item.restaurant ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.restaurant.name}`} onPress={() => props.onOpenRestaurant(item)} style={styles.restaurantRow}>
              <Ionicons name="storefront-outline" size={14} color={colors.textMuted} />
              <Text style={styles.restaurant} numberOfLines={1}>
                {item.restaurant.name}
                {item.restaurant.suburb ? ` · ${item.restaurant.suburb}` : ''}
                {item.restaurant.ratingAvg ? ` · ★ ${item.restaurant.ratingAvg.toFixed(1)}` : ''}
                {item.restaurant.distanceKm !== null ? ` · ${item.restaurant.distanceKm} km` : ''}
              </Text>
            </Pressable>
          ) : null}

          {item.meal ? (
            <View style={styles.mealCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mealName} numberOfLines={1}>{item.meal.name}</Text>
                <Text style={styles.mealPrice}>{formatAud(item.meal.priceCents)}</Text>
                {!item.orderable && item.notOrderableReason ? <Text style={styles.notOrderable}>{item.notOrderableReason}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.orderable ? `Order ${item.meal.name}` : `${item.meal.name} is not available to order`}
                accessibilityState={{ disabled: !item.orderable }}
                disabled={!item.orderable}
                onPress={() => props.onOrder(item)}
                style={({ pressed }) => [styles.orderBtn, !item.orderable && styles.orderDisabled, pressed && { backgroundColor: colors.accentPressed }]}>
                <Text style={styles.orderText}>{item.orderable ? 'Order now' : 'Unavailable'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

export const FeedItem = memo(FeedItemComponent);

const styles = StyleSheet.create({
  page: { width: '100%', backgroundColor: colors.bg, overflow: 'hidden' },
  videoFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, gap: 10 },
  fallbackText: { ...type.heading, color: colors.textDim },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  stamp: { position: 'absolute', top: '30%', paddingHorizontal: 18, paddingVertical: 8, borderWidth: 4, borderRadius: radius.md },
  craveStamp: { left: 28, borderColor: colors.accent },
  nopeStamp: { right: 28, borderColor: colors.text },
  stampText: { fontSize: 28, fontWeight: '900', letterSpacing: 1 },
  pauseIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFill },
  topRow: { position: 'absolute', top: 104, left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  demoBadge: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  demoText: { color: colors.text, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rail: { position: 'absolute', right: 10, bottom: 210, alignItems: 'center' },
  bottom: { position: 'absolute', left: space.lg, right: 76, bottom: 24 },
  uploaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  uploader: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  followBtn: { borderWidth: 1, borderColor: colors.text, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  following: { borderColor: colors.textMuted, backgroundColor: 'rgba(255,255,255,0.08)' },
  followText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  kindBadge: { backgroundColor: colors.accentSoft, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  kindText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  sponsored: { ...type.caption, color: colors.text, fontWeight: '700', marginBottom: 4, opacity: 0.9 },
  caption: { ...type.body, color: colors.text, marginBottom: 4 },
  reason: { ...type.caption, color: colors.accent, fontWeight: '600', marginBottom: 8 },
  restaurantRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  restaurant: { ...type.caption, color: colors.textMuted, fontWeight: '600', flexShrink: 1 },
  mealCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(20,20,20,0.88)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border },
  mealName: { ...type.bodyStrong, color: colors.text },
  mealPrice: { ...type.price, color: colors.text, marginTop: 2 },
  notOrderable: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  orderBtn: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 20, minHeight: 48, justifyContent: 'center' },
  orderDisabled: { backgroundColor: colors.surfaceRaised },
  orderText: { color: colors.text, fontWeight: '800', fontSize: 15 },
});
