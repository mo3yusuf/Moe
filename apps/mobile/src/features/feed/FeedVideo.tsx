import Ionicons from '@expo/vector-icons/Ionicons';
import {
  classifySwipe, DIETARY_LABELS, formatMoney, NOT_ORDERABLE_COPY, PAN_ACTIVATION, SWIPE_LABELS,
  type DietaryTag, type SwipeDirection,
} from '@crave/core';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors, font, HIT, radius, space } from '@/theme/tokens';
import { reportVideo } from '@/features/moderation/report';
import { track, watchSession } from './events';
import type { FeedEntry } from './use-feed';
import { useSoundOn } from './sound';
import { Alert } from '@/lib/alert';

export type InputMethod = 'gesture' | 'button' | 'accessibility_action';

export interface FeedVideoProps {
  item: FeedEntry;
  width: number;
  height: number;
  /** Visible item: plays. */
  isActive: boolean;
  /** Adjacent item: player is created and buffered but paused (preloading). */
  preload: boolean;
  /** App/tab focus; pause when the feed is not on screen. */
  focused: boolean;
  bottomInset: number;
  orderingEnabled: boolean;
  onSwipe(item: FeedEntry, direction: SwipeDirection, method: InputMethod): void;
  onToggleLike(item: FeedEntry): void;
  onToggleSave(item: FeedEntry): void;
  onShare(item: FeedEntry): void;
  onComments(item: FeedEntry): void;
  onFollowCreator(item: FeedEntry): void;
  onOrder(item: FeedEntry): void;
  onNext(): void;
  onPrevious(): void;
}

const STAMP_MS = 1100;

function FeedVideoBase(props: FeedVideoProps) {
  const { item, width, height, isActive, preload, focused, bottomInset, orderingEnabled } = props;
  const shouldLoad = isActive || preload;
  const soundOn = useSoundOn();
  const player = useVideoPlayer(shouldLoad ? { uri: item.playbackUrl, useCaching: true } : null, (p) => {
    p.loop = true;
    p.muted = !soundOn; // browsers block autoplay with sound
    p.timeUpdateEventInterval = 0.5;
  });
  useEffect(() => { player.muted = !soundOn; }, [soundOn, player]);
  const [paused, setPaused] = useState(false);
  // Fill the screen (like TikTok) only for tall videos; show wider ones whole with bars instead of
  // cropping them into a "zoomed in" view. The thumbnail has the video's shape (Mux provides one);
  // without one we assume vertical.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  useEffect(() => {
    if (!item.thumbnailUrl) return;
    let alive = true;
    Image.getSize(item.thumbnailUrl, (w, h) => { if (alive && w && h) setVideoAspect(w / h); }, () => {});
    return () => { alive = false; };
  }, [item.thumbnailUrl]);
  const screenAspect = width && height ? width / height : 9 / 19.5;
  // Unknown shape (no thumbnail): assume a vertical phone video and fill, as almost all uploads are.
  const fit = videoAspect == null || videoAspect <= screenAspect * 1.35 ? 'cover' : 'contain';
  const [stamp, setStamp] = useState<SwipeDirection | null>(null);
  const lastTime = useRef(0);
  const durationMs = item.durationMs ?? 0;
  const meta = { menuItemId: item.menuItem?.id ?? null, feedRequestId: item.feedRequestId };

  // Play only the active item while the feed is focused. Track viewing for recommendations.
  useEffect(() => {
    const playing = isActive && focused && !paused;
    if (playing) player.play(); else player.pause();
  }, [isActive, focused, paused, player]);

  useEffect(() => {
    if (!isActive || !focused) return;
    setPaused(false);
    lastTime.current = 0;
    const started = watchSession.activate(item.videoId, meta);
    track(...started);
    return () => track(...watchSession.deactivate(item.videoId, durationMs, meta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, focused, item.videoId]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!isActive) return;
    const ms = currentTime * 1000;
    // A large backwards jump near the end means the clip looped.
    if (durationMs > 0 && lastTime.current > durationMs * 0.8 && ms < durationMs * 0.2) watchSession.looped(item.videoId);
    lastTime.current = ms;
    watchSession.progress(item.videoId, ms);
  });

  // --- Smart Swipe gesture -------------------------------------------------------------
  const tx = useSharedValue(0);

  const release = (dx: number, dy: number, vx: number) => {
    const direction = classifySwipe({ dx, dy, vx, width });
    if (!direction) {
      tx.value = withSpring(0, { damping: 18 });
      return;
    }
    commit(direction, 'gesture');
  };

  const commit = (direction: SwipeDirection, method: InputMethod) => {
    const sign = direction === 'right' ? 1 : -1;
    // Timing (not springs) so the card never overshoots past centre and flashes the opposite label.
    tx.value = method === 'gesture'
      ? withTiming(0, { duration: 220 })
      : withSequence(withTiming(sign * 48, { duration: 110 }), withTiming(0, { duration: 180 }));
    void Haptics.impactAsync(direction === 'right' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    setStamp(direction);
    setTimeout(() => setStamp(null), STAMP_MS);
    props.onSwipe(item, direction, method);
  };

  const pan = usePanGesture({
    activeOffsetX: PAN_ACTIVATION.activeOffsetX,
    failOffsetY: PAN_ACTIVATION.failOffsetY,
    onUpdate: (e) => {
      'worklet';
      tx.value = e.translationX * 0.9;
    },
    onDeactivate: (e) => {
      'worklet';
      scheduleOnRN(release, e.translationX, e.translationY, e.velocityX);
    },
  });
  const tap = useTapGesture({
    maxDuration: 250,
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled) scheduleOnRN(setPaused, (p: boolean) => !p);
    },
  });
  const gesture = useCompetingGestures(pan, tap);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { rotateZ: `${interpolate(tx.value, [-width, width], [-6, 6], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const craveHint = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, width * 0.3], [0, 1], Extrapolation.CLAMP) }));
  const passHint = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [-width * 0.3, 0], [1, 0], Extrapolation.CLAMP) }));

  // --- Accessibility: every gesture has an equivalent action -------------------------------
  const a11yActions = [
    { name: 'crave', label: 'Crave it: more like this' },
    { name: 'pass', label: 'Not for me: fewer like this' },
    { name: 'next', label: 'Next video' },
    { name: 'previous', label: 'Previous video' },
    { name: 'activate', label: paused ? 'Play' : 'Pause' },
    ...(item.orderable && orderingEnabled ? [{ name: 'order', label: 'Order this meal' }] : []),
  ];
  const onA11yAction = (e: AccessibilityActionEvent) => {
    switch (e.nativeEvent.actionName) {
      case 'crave': return commit('right', 'accessibility_action');
      case 'pass': return commit('left', 'accessibility_action');
      case 'next': return props.onNext();
      case 'previous': return props.onPrevious();
      case 'activate': return setPaused((p) => !p);
      case 'order': return props.onOrder(item);
    }
  };

  const price = item.menuItem ? formatMoney(item.menuItem.priceCents, item.menuItem.currency) : null;
  const summary = [
    item.caption,
    item.menuItem ? `${item.menuItem.name}, ${price}` : null,
    item.restaurant ? `from ${item.restaurant.name}, ${item.restaurant.suburb ?? ''}` : null,
    item.isSponsored ? 'Sponsored' : null,
  ].filter(Boolean).join('. ');

  return (
    <View style={{ width, height, backgroundColor: colors.bg, overflow: 'hidden' }}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[StyleSheet.absoluteFill, cardStyle]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={summary}
          accessibilityHint="Swipe right to crave, left for not for me. Use actions for more options."
          accessibilityActions={a11yActions}
          onAccessibilityAction={onA11yAction}
        >
          {shouldLoad ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} playsInline />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text style={[font.title, { color: colors.textFaint }]}>{item.menuItem?.name ?? 'CRAVE'}</Text>
            </View>
          )}
          <Fade edge="top" height={150} maxOpacity={0.35} />
          <Fade edge="bottom" height={340} maxOpacity={0.6} />
          <Animated.View style={[styles.hint, styles.hintRight, craveHint]} pointerEvents="none">
            <Text style={styles.hintText}>{SWIPE_LABELS.right}</Text>
          </Animated.View>
          <Animated.View style={[styles.hint, styles.hintLeft, passHint]} pointerEvents="none">
            <Text style={[styles.hintText, { color: colors.text }]}>{SWIPE_LABELS.left}</Text>
          </Animated.View>
          {paused ? (
            <View style={styles.center} pointerEvents="none">
              <Ionicons name="play" size={72} color="rgba(255,255,255,0.85)" />
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {stamp ? (
        <View style={styles.center} pointerEvents="none" accessibilityLiveRegion="polite">
          <View style={[styles.stamp, stamp === 'right' ? styles.stampCrave : styles.stampPass]}>
            <Text style={[font.title, { color: colors.text }]}>{stamp === 'right' ? 'Craved!' : 'Not for me'}</Text>
            <Text style={[font.small, { color: colors.text }]}>
              {stamp === 'right' ? 'Saved to your Cravings' : 'We’ll show fewer like this'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Action rail (TikTok-style) — outside the gesture detector so swipes never steal button taps. */}
      <View style={[styles.rail, { bottom: bottomInset + (item.menuItem ? 150 : 96) }]}>
        <RailButton icon={item.viewer.craved ? 'flame' : 'flame-outline'} label="Crave" active={item.viewer.craved}
          a11yLabel="Crave it" onPress={() => commit('right', 'button')} />
        <RailButton icon={item.viewer.liked ? 'heart' : 'heart-outline'} label={String(item.stats.likes + (item.viewer.liked ? 1 : 0))}
          a11yLabel={item.viewer.liked ? 'Unlike' : 'Like'} active={item.viewer.liked} onPress={() => props.onToggleLike(item)} />
        <RailButton icon="chatbubble-ellipses" label={String(item.stats.comments)} a11yLabel={`Comments (${item.stats.comments})`} onPress={() => props.onComments(item)} />
        <RailButton icon={item.viewer.saved ? 'bookmark' : 'bookmark-outline'} label="Save" active={item.viewer.saved}
          onPress={() => props.onToggleSave(item)} />
        <RailButton icon="arrow-redo" label="Share" onPress={() => props.onShare(item)} />
        <RailButton icon="ellipsis-horizontal" label="More" a11yLabel="More options" onPress={() => Alert.alert('More', undefined, [
          { text: 'Not for me', onPress: () => commit('left', 'button') },
          { text: 'Report video', style: 'destructive', onPress: () => reportVideo(item.videoId, item.creator ? { id: item.creator.id, handle: item.creator.handle } : undefined, props.onNext) },
          { text: 'Cancel', style: 'cancel' },
        ])} />
      </View>

      {/* Meal info and ordering. */}
      <View style={[styles.info, { paddingBottom: bottomInset + space.md }]} pointerEvents="box-none">
        {item.isSponsored ? (
          <View style={styles.sponsored}><Text style={[font.label, { color: colors.bg }]}>{item.sponsorDisclosure ?? 'Sponsored'}</Text></View>
        ) : null}
        {item.creator?.handle ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={[font.heading, styles.shadow]}>@{item.creator.handle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={item.viewer.followingCreator ? `Unfollow @${item.creator.handle}` : `Follow @${item.creator.handle}`}
              onPress={() => props.onFollowCreator(item)} hitSlop={10}
              style={{ borderWidth: 1, borderColor: colors.text, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
              <Text style={[font.label, { color: colors.text }]}>{item.viewer.followingCreator ? 'Following' : 'Follow'}</Text>
            </Pressable>
          </View>
        ) : null}
        {item.caption ? <Text style={[font.body, styles.shadow]} numberOfLines={2}>{item.caption}</Text> : null}
        {item.ranking?.reasons[0] ? (
          <Text style={[font.label, styles.shadow, { color: colors.textMuted, fontSize: 12 }]} accessibilityLabel={`Why you're seeing this: ${item.ranking.reasons[0]}`}>
            ✦ {item.ranking.reasons[0]}
          </Text>
        ) : null}
        {item.restaurant ? (
          <Text style={[font.small, styles.shadow, { color: colors.textMuted }]}>
            {item.restaurant.name} · {item.restaurant.suburb}
            {item.restaurant.distanceKm != null ? ` · ${item.restaurant.distanceKm} km` : ''}
            {item.restaurant.halalCertified ? ' · Halal certified' : ''}
          </Text>
        ) : null}
        {item.menuItem ? (
          <View style={styles.orderRow}>
            <View style={{ flex: 1 }}>
              <Text style={[font.heading, styles.shadow]} numberOfLines={2}>{item.menuItem.name}</Text>
              <Text style={[font.heading, styles.shadow, { color: colors.text }]}>{price}</Text>
              {item.menuItem.dietaryTags.length ? (
                <Text style={[font.small, { color: colors.textMuted }]}>
                  {item.menuItem.dietaryTags.map((t) => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !(item.orderable && orderingEnabled) }}
              accessibilityLabel={item.orderable && orderingEnabled ? `Order ${item.menuItem.name} for ${price}` : undefined}
              disabled={!(item.orderable && orderingEnabled)}
              onPress={() => props.onOrder(item)}
              style={({ pressed }) => [styles.orderBtn, !(item.orderable && orderingEnabled) && styles.orderBtnDisabled, !orderingEnabled && styles.soonChip, pressed && { backgroundColor: colors.accentPressed }]}
            >
              <Text style={[orderingEnabled ? font.heading : styles.soonText, { color: colors.text }]}>
                {!orderingEnabled ? 'Ordering soon' : item.orderable ? 'Order now' : NOT_ORDERABLE_COPY[item.notOrderableReason ?? 'no_linked_item']}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RailButton({ icon, label, a11yLabel, active, onPress }: {
  icon: ComponentProps<typeof Ionicons>['name']; label: string; a11yLabel?: string; active?: boolean; onPress(): void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11yLabel ?? label} accessibilityState={{ selected: !!active }}
      onPress={onPress} hitSlop={8} style={styles.railBtn}>
      <Ionicons name={icon} size={32} color={active ? colors.accent : colors.text} style={styles.iconShadow} />
      <Text style={[styles.railLabel, styles.shadow]}>{label}</Text>
    </Pressable>
  );
}

/** Smooth dark fade (stacked bands) so overlay text stays readable without hard edges. Works on web and native. */
function Fade({ edge, height, maxOpacity }: { edge: 'top' | 'bottom'; height: number; maxOpacity: number }) {
  if (Platform.OS === 'web') {
    // Browsers: a real CSS gradient (perfectly smooth).
    const dir = edge === 'top' ? 'to bottom' : 'to top';
    const css = `linear-gradient(${dir}, rgba(0,0,0,${maxOpacity}) 0%, rgba(0,0,0,${maxOpacity * 0.45}) 45%, rgba(0,0,0,0) 100%)`;
    return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height, [edge]: 0, backgroundImage: css } as object} />;
  }
  const bands = 32;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height, [edge]: 0 }}>
      {Array.from({ length: bands }, (_, i) => {
        const t = edge === 'top' ? 1 - i / bands : (i + 1) / bands; // strongest at the screen edge
        return <View key={i} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${(maxOpacity * t * t).toFixed(3)})` }} />;
      })}
    </View>
  );
}

export const FeedVideo = memo(FeedVideoBase);

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  hint: { position: 'absolute', top: 120, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 3 },
  hintRight: { left: space.xl, borderColor: colors.accent, transform: [{ rotateZ: '-12deg' }] },
  hintLeft: { right: space.xl, borderColor: colors.text, transform: [{ rotateZ: '12deg' }] },
  hintText: { fontSize: 28, fontWeight: '900', color: colors.accent, letterSpacing: 1 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  stamp: { paddingHorizontal: space.xl, paddingVertical: space.lg, borderRadius: radius.lg, alignItems: 'center', gap: 2 },
  stampCrave: { backgroundColor: colors.accent },
  stampPass: { backgroundColor: 'rgba(29,29,32,0.92)' },
  rail: { position: 'absolute', right: 6, alignItems: 'center', gap: space.md },
  railBtn: { minWidth: HIT, minHeight: HIT, alignItems: 'center', justifyContent: 'center', gap: 1 },
  railLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingRight: 76, gap: 4 },
  shadow: { color: colors.text, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  sponsored: { alignSelf: 'flex-start', backgroundColor: colors.warning, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm },
  orderRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginTop: space.sm, marginRight: -68 },
  orderBtn: { minHeight: 52, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  orderBtnDisabled: { backgroundColor: colors.surfaceRaised },
  // Pilot (ordering off): a small quiet label instead of a big button.
  soonChip: { minHeight: 30, paddingHorizontal: space.md, backgroundColor: 'rgba(255,255,255,0.18)' },
  soonText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
});
