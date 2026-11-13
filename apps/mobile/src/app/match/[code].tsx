import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, AppState, Easing, PanResponder, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, Skeleton, T } from '@/components/ui';
import { setSoundOn, useSoundOn } from '@/features/feed/sound';
import { takePendingMatch } from '@/lib/pending-match';
import { supabase } from '@/lib/supabase';
import { colors, font, palette, radius, space } from '@/theme/tokens';

interface DeckItem {
  videoId: string; playbackUrl: string | null; thumbnailUrl: string | null; caption: string | null;
  restaurantId: string | null; restaurantName: string | null; myDirection: 'right' | 'left' | null; rights: number;
}
interface RoomState {
  roomId: string; code: string; hostId: string; me: string; expiresAt: string;
  members: { userId: string; name: string; swiped: number }[];
  deck: DeckItem[];
  matches: { videoId: string; matchedAt: string }[];
}

const POLL_MS = 2500;
// Phone browsers: the card owns every drag (nothing here scrolls), so the browser must not claim them.
const WEB_NO_TOUCH_SCROLL = Platform.OS === 'web' ? ({ touchAction: 'none' } as object) : null;
const SWIPE_OUT = 120;
const AVATAR_COLORS = ['#FF4D2E', '#4C7DFF', '#22C55E', '#F59E0B', '#A855F7', '#14B8A6', '#EC4899', '#EAB308'];

function buzz(kind: 'light' | 'success') {
  if (Platform.OS === 'web') {
    try { (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(kind === 'success' ? [30, 60, 30, 60, 120] : 15); } catch { /* unsupported */ }
    return;
  }
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** A Crave Match room: everyone swipes the same deck; a dish all members crave is a match. */
export default function MatchRoom() {
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const code = (rawCode ?? '').toUpperCase();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localSwipes, setLocalSwipes] = useState<Record<string, 'right' | 'left'>>({});
  const [celebrate, setCelebrate] = useState<DeckItem | null>(null);
  const [showMatches, setShowMatches] = useState(false);
  const [copied, setCopied] = useState(false);
  const seenMatches = useRef<Set<string> | null>(null);
  const roomId = state?.roomId;

  // This screen is the destination of any remembered invite link.
  useEffect(() => { takePendingMatch(); }, []);

  // Join (idempotent), then poll the room while the screen is open.
  useEffect(() => {
    if (!supabase || !code) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let id: string | null = null;
    const tick = async () => {
      if (!alive || !supabase) return;
      if (!id) {
        const { data, error: e } = await supabase.rpc('join_crave_room', { p_code: code });
        if (!alive) return;
        if (e || !data) { setError(e?.message ?? 'Couldn’t join this group'); return; }
        id = (data as { roomId: string }).roomId;
      }
      if (AppState.currentState === 'active') {
        const { data, error: e } = await supabase.rpc('crave_room_state', { p_room: id });
        if (!alive) return;
        if (e) setError(e.message);
        else if (data) setState(data as RoomState);
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [code]);

  // New matches (from anyone's swipe) → celebrate. Matches that existed when we opened are not re-celebrated.
  useEffect(() => {
    if (!state) return;
    if (!seenMatches.current) { seenMatches.current = new Set(state.matches.map((m) => m.videoId)); return; }
    const fresh = state.matches.find((m) => !seenMatches.current!.has(m.videoId));
    if (fresh) {
      seenMatches.current.add(fresh.videoId);
      const item = state.deck.find((d) => d.videoId === fresh.videoId);
      if (item) { setCelebrate(item); buzz('success'); }
    }
  }, [state]);

  const deck = useMemo(() => (state?.deck ?? []).map((d) => ({ ...d, myDirection: localSwipes[d.videoId] ?? d.myDirection })), [state, localSwipes]);
  const remaining = deck.filter((d) => !d.myDirection);
  const current = remaining[0] ?? null;
  const next = remaining[1] ?? null;
  const others = Math.max(0, (state?.members.length ?? 1) - 1);

  const swipe = useCallback(async (item: DeckItem, direction: 'right' | 'left') => {
    if (!supabase || !roomId) return;
    buzz('light');
    setLocalSwipes((s) => ({ ...s, [item.videoId]: direction }));
    const { data, error: e } = await supabase.rpc('crave_room_swipe', { p_room: roomId, p_video: item.videoId, p_direction: direction });
    if (e) { setError(e.message); setLocalSwipes((s) => { const n = { ...s }; delete n[item.videoId]; return n; }); return; }
    if ((data as { matched?: boolean })?.matched) {
      seenMatches.current?.add(item.videoId);
      setCelebrate(item);
      buzz('success');
    }
  }, [roomId]);

  async function invite() {
    const url = Linking.createURL(`/match/${code}`);
    const message = `Let’s decide where to eat 🔥 Join my Crave Match: ${url}  (code ${code})`;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await (navigator as Navigator & { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({ title: 'Crave Match', text: `Let’s decide where to eat 🔥 Code ${code}`, url }); return; } catch { /* cancelled */ }
    }
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(message); setError(null); setCopied(true); setTimeout(() => setCopied(false), 2000); return; } catch { /* fall through */ }
    }
    await Share.share({ message });
  }

  const matchedItems = (state?.matches ?? []).map((m) => deck.find((d) => d.videoId === m.videoId)).filter(Boolean) as DeckItem[];
  const closest = [...deck].filter((d) => d.rights > 0).sort((a, b) => b.rights - a.rights)[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.iconBtn}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T variant="heading">Crave Match</T>
          <Pressable accessibilityRole="button" accessibilityLabel={`Group code ${code.split('').join(' ')}. Tap to invite`} onPress={invite} hitSlop={8}>
            <Text style={styles.code}>{copied ? 'LINK COPIED ✓' : code}</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Invite friends" hitSlop={12} onPress={invite} style={styles.iconBtn}>
          <Ionicons name="person-add" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Members */}
      <View style={styles.membersRow}>
        <View style={{ flexDirection: 'row' }}>
          {(state?.members ?? []).slice(0, 6).map((m, i) => (
            <View key={m.userId} accessibilityLabel={m.userId === state?.me ? 'You' : m.name}
              style={[styles.avatar, { backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], marginLeft: i ? -10 : 0 }]}>
              <Text style={styles.avatarText}>{m.userId === state?.me ? 'Me' : m.name.slice(0, 1).toUpperCase()}</Text>
            </View>
          ))}
        </View>
        <T variant="small" muted>
          {!state ? ' ' : others === 0 ? 'Waiting for friends to join…' : `Swiping with ${others} friend${others === 1 ? '' : 's'}`}
        </T>
        {matchedItems.length ? (
          <Pressable accessibilityRole="button" onPress={() => setShowMatches(true)} style={styles.matchPill}>
            <Ionicons name="flame" size={14} color={colors.text} />
            <Text style={[font.label, { color: colors.text }]}>{matchedItems.length} match{matchedItems.length === 1 ? '' : 'es'}</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Notice tone="danger" style={{ marginHorizontal: space.lg, marginBottom: space.sm }}>{error}</Notice> : null}

      {/* Card stack */}
      <View style={styles.stage}>
        <View style={styles.deckArea}>
        {!state && !error ? <Skeleton height={480} radius={24} style={{ width: '100%', flex: 1 }} /> : null}
        {state && state.deck.length === 0 ? (
          <Empty icon="videocam-outline" title="No videos to swipe yet" body="Once a few food videos are posted, start a new group." />
        ) : null}
        {state && state.deck.length > 0 && !current ? (
          <Empty icon="checkmark-done" title="You’ve swiped them all"
            body={matchedItems.length ? 'Tap your matches above to see where to eat.'
              : closest ? `Closest so far: ${closest.caption ?? 'a dish'} — ${closest.rights} of ${state.members.length} craved it. Waiting for friends…`
              : 'Waiting for your friends to finish swiping…'} />
        ) : null}
        {next ? <SwipeCard key={`n-${next.videoId}`} item={next} active={false} othersCraved={0} onSwipe={() => {}} /> : null}
        {current ? (
          <SwipeCard key={current.videoId} item={current} active othersCraved={Math.max(0, current.rights)}
            onSwipe={(dir) => void swipe(current, dir)} />
        ) : null}
        </View>
      </View>

      {/* Buttons */}
      {current ? (
        <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Not for me" onPress={() => void swipe(current, 'left')}
            style={({ pressed }) => [styles.roundBtn, styles.nopeBtn, pressed && { transform: [{ scale: 0.92 }] }]}>
            <Ionicons name="close" size={34} color={palette.danger.lighter} />
          </Pressable>
          <Text style={[font.small, { color: colors.textMuted }]}>{remaining.length} left</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Crave it" onPress={() => void swipe(current, 'right')}
            style={({ pressed }) => [styles.roundBtn, styles.craveBtn, pressed && { transform: [{ scale: 0.92 }] }]}>
            <Ionicons name="flame" size={34} color={colors.text} />
          </Pressable>
        </View>
      ) : <View style={{ height: insets.bottom + space.lg }} />}

      {celebrate ? (
        <MatchCelebration item={celebrate} people={state?.members.length ?? 2}
          onClose={() => setCelebrate(null)}
          onRestaurant={celebrate.restaurantId ? () => { setCelebrate(null); router.push(`/restaurant/${celebrate.restaurantId}`); } : undefined} />
      ) : null}

      {showMatches ? (
        <View style={[StyleSheet.absoluteFill, styles.sheetBackdrop]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close matches" onPress={() => setShowMatches(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
            <T variant="title">Your matches 🔥</T>
            {matchedItems.map((m) => (
              <Pressable key={m.videoId} accessibilityRole="button" onPress={() => { setShowMatches(false); setCelebrate(m); }} style={styles.matchRow}>
                <Ionicons name="flame" size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <T variant="heading" numberOfLines={1}>{m.caption ?? 'A dish you all craved'}</T>
                  {m.restaurantName ? <T variant="small" muted>{m.restaurantName}</T> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            ))}
            <Button title="Keep swiping" variant="secondary" onPress={() => setShowMatches(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Empty({ icon, title, body }: { icon: 'videocam-outline' | 'checkmark-done'; title: string; body: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, maxWidth: 380 }}>
      <Ionicons name={icon} size={44} color={colors.textMuted} />
      <T variant="title" style={{ textAlign: 'center' }}>{title}</T>
      <T muted style={{ textAlign: 'center' }}>{body}</T>
    </View>
  );
}

/** A Tinder-style card with the food video playing; drag right to crave, left to pass. */
function SwipeCard({ item, active, othersCraved, onSwipe }: {
  item: DeckItem; active: boolean; othersCraved: number; onSwipe(dir: 'right' | 'left'): void;
}) {
  const { width } = useWindowDimensions();
  const soundOn = useSoundOn();
  const pos = useRef(new Animated.ValueXY()).current;
  const player = useVideoPlayer(active && item.playbackUrl ? { uri: item.playbackUrl } : null, (p) => {
    p.loop = true; p.muted = !soundOn; p.play();
  });
  useEffect(() => { player.muted = !soundOn; }, [soundOn, player]);

  const fling = useCallback((dir: 'right' | 'left') => {
    Animated.timing(pos, { toValue: { x: (dir === 'right' ? 1 : -1) * (width + 200), y: 40 }, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' })
      .start(() => onSwipe(dir));
  }, [pos, width, onSwipe]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => active && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (g.dx > SWIPE_OUT || g.vx > 0.8) fling('right');
      else if (g.dx < -SWIPE_OUT || g.vx < -0.8) fling('left');
      else Animated.spring(pos, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: Platform.OS !== 'web' }).start();
    },
  }), [active, pos, fling]);

  const rotate = pos.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });
  const craveOpacity = pos.x.interpolate({ inputRange: [0, SWIPE_OUT], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeOpacity = pos.x.interpolate({ inputRange: [-SWIPE_OUT, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      {...(active ? pan.panHandlers : {})}
      accessible={active}
      accessibilityLabel={`${item.caption ?? 'Food video'}${item.restaurantName ? ` at ${item.restaurantName}` : ''}`}
      accessibilityHint="Swipe right to crave it, left to pass, or use the buttons below"
      style={[styles.card, WEB_NO_TOUCH_SCROLL, !active && styles.cardBehind, active && { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}>
      {active && item.playbackUrl ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} playsInline />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceRaised }]} />
      )}
      <View pointerEvents="none" style={[styles.cardFade, Platform.OS === 'web'
        ? ({ backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 50%, rgba(0,0,0,0) 100%)' } as object)
        : { backgroundColor: 'rgba(0,0,0,0.35)' }]} />

      {active ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampCrave, { opacity: craveOpacity }]}>
            <Text style={[styles.stampText, { color: colors.accent }]}>CRAVE</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampNope, { opacity: nopeOpacity }]}>
            <Text style={[styles.stampText, { color: colors.text }]}>NOPE</Text>
          </Animated.View>
          <Pressable accessibilityRole="button" accessibilityLabel={soundOn ? 'Mute' : 'Turn sound on'} hitSlop={10}
            onPress={() => setSoundOn(!soundOn)} style={styles.cardSound}>
            <Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={18} color={colors.text} />
          </Pressable>
        </>
      ) : null}

      <View pointerEvents="none" style={styles.cardInfo}>
        {othersCraved > 0 ? (
          <View style={styles.cravedChip}>
            <Ionicons name="flame" size={12} color={colors.text} />
            <Text style={[font.label, { color: colors.text }]}>{othersCraved} craved this</Text>
          </View>
        ) : null}
        {item.caption ? <Text style={[font.title, styles.shadow]} numberOfLines={2}>{item.caption}</Text> : null}
        {item.restaurantName ? <Text style={[font.small, styles.shadow, { color: colors.textMuted }]}>{item.restaurantName}</Text> : null}
      </View>
    </Animated.View>
  );
}

/** The big moment: everyone craved the same dish. */
function MatchCelebration({ item, people, onClose, onRestaurant }: {
  item: DeckItem; people: number; onClose(): void; onRestaurant?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0.6)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const burst = useRef(Array.from({ length: 14 }, () => new Animated.Value(0))).current;
  const native = Platform.OS !== 'web';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: native }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: native }),
      Animated.stagger(25, burst.map((b) => Animated.timing(b, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: native }))),
    ]).start();
  }, [fade, scale, burst, native]);

  const emojis = ['🔥', '🍜', '🌮', '🍕', '🍔', '🍣', '✨'];
  return (
    <Animated.View accessibilityViewIsModal accessibilityLiveRegion="assertive" style={[StyleSheet.absoluteFill, styles.celebrate, { opacity: fade, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
      {burst.map((b, i) => {
        const angle = (i / burst.length) * Math.PI * 2;
        return (
          <Animated.Text key={i} pointerEvents="none" style={[styles.burst, {
            opacity: b.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: b.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 170] }) },
              { translateY: b.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 220] }) },
              { scale: b.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) },
            ],
          }]}>{emojis[i % emojis.length]}</Animated.Text>
        );
      })}
      <Animated.View style={{ alignItems: 'center', gap: space.md, transform: [{ scale }], paddingHorizontal: space.xl }}>
        <Text style={styles.matchTitle}>IT’S A{'\n'}MATCH!</Text>
        <T muted style={{ textAlign: 'center' }}>{people === 2 ? 'You both' : `All ${people} of you`} craved</T>
        <View style={styles.matchCard}>
          <Ionicons name="flame" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <T variant="title" numberOfLines={2}>{item.caption ?? 'The same dish'}</T>
            {item.restaurantName ? <T muted>{item.restaurantName}</T> : null}
          </View>
        </View>
      </Animated.View>
      <View style={{ gap: space.sm, alignSelf: 'stretch', paddingHorizontal: space.xl }}>
        {onRestaurant ? <Button title="Let’s go — see the restaurant" onPress={onRestaurant} /> : null}
        <Button title="Keep swiping" variant="secondary" onPress={onClose} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  code: { ...font.label, color: colors.accent, letterSpacing: 3, marginTop: 2 },
  membersRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md, minHeight: 44 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  avatarText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  matchPill: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  stage: { flex: 1, alignItems: 'center', paddingHorizontal: space.lg },
  deckArea: { flex: 1, width: '100%', maxWidth: 440, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surface,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  cardBehind: { transform: [{ scale: 0.95 }, { translateY: 12 }], opacity: 0.6 },
  cardFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  cardInfo: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, gap: 4 },
  cardSound: { position: 'absolute', top: space.md, right: space.md, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  cravedChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,77,46,0.9)', borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3, marginBottom: 4 },
  shadow: { color: colors.text, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  stamp: { position: 'absolute', top: 36, paddingHorizontal: space.md, paddingVertical: 4, borderWidth: 4, borderRadius: radius.md },
  stampCrave: { left: 24, borderColor: colors.accent, transform: [{ rotate: '-14deg' }] },
  stampNope: { right: 24, borderColor: colors.text, transform: [{ rotate: '14deg' }] },
  stampText: { fontSize: 36, fontWeight: '900', letterSpacing: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingTop: space.lg },
  roundBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  nopeBtn: { backgroundColor: colors.surface, borderWidth: 2, borderColor: palette.danger.default },
  craveBtn: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  celebrate: { backgroundColor: 'rgba(10,10,11,0.94)', alignItems: 'center', justifyContent: 'space-between' },
  burst: { position: 'absolute', top: '38%', left: '50%', fontSize: 30 },
  matchTitle: { fontSize: 56, lineHeight: 58, fontWeight: '900', color: colors.accent, textAlign: 'center', letterSpacing: -1, marginTop: '20%' },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, alignSelf: 'stretch', borderWidth: 1, borderColor: colors.accent },
  sheetBackdrop: { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.lg, gap: space.md },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 48 },
});
