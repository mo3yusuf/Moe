import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, font, HIT, palette, radius, space, type Tone } from '@/theme/tokens';

type Variant = keyof typeof font;

export function T({ variant = 'body', muted, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean }) {
  return <Text {...rest} style={[font[variant], { color: muted ? colors.textMuted : colors.text }, style]} />;
}

export function Screen({ children, edges = ['top'], style, padded = true }: {
  children: ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle>; padded?: boolean;
}) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.bg }, padded && { paddingHorizontal: space.lg }, style]}>
      {children}
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, variant = 'primary', loading, disabled, icon, style, ...rest }: PressableProps & {
  title: string; variant?: ButtonVariant; loading?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: colors.accent, secondary: colors.surfaceRaised, ghost: 'transparent', danger: 'transparent' }[variant];
  const fg = variant === 'danger' ? colors.danger : colors.text;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        // Disabled primary buttons turn grey (not just faded) so it's obvious something is still needed.
        { backgroundColor: disabled && variant === 'primary' ? colors.surfaceRaised : pressed && variant === 'primary' ? colors.accentPressed : bg,
          opacity: disabled ? 0.6 : loading ? 0.8 : pressed ? 0.85 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: colors.danger },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.row}>
          {icon}
          {/* 18px heavy = WCAG "large text", so white on the orange accent meets the 3:1 contrast rule. */}
          <Text style={[font.heading, { color: fg, fontSize: 18, fontWeight: '800' }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** "Still needed" checklist shown above a disabled button, so people can see what's missing. */
export function MissingHint({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
      <Text style={[font.small, { color: colors.textMuted }]}>To continue:</Text>
      {items.map((m) => (
        <Text key={m} style={[font.small, { color: colors.warning }]}>•  {m}</Text>
      ))}
    </View>
  );
}

export function Field({ label, error, style, ...rest }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <T variant="label" muted>{label.toUpperCase()}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style as StyleProp<TextStyle>]}
        {...rest}
      />
      {error ? <T variant="small" style={{ color: palette.danger.lighter }} accessibilityLiveRegion="polite">⚠︎ {error}</T> : null}
    </View>
  );
}

export function ToggleRow({ label, description, value, onValueChange, disabled }: {
  label: string; description?: string; value: boolean; onValueChange(v: boolean): void; disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading">{label}</T>
        {description ? <T variant="small" muted>{description}</T> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function ListRow({ title, subtitle, onPress, right, destructive, icon }: {
  title: string; subtitle?: string; onPress?(): void; right?: ReactNode; destructive?: boolean;
  /** Optional leading icon (Apple Settings style). */
  icon?: ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      {icon ? (
        <View style={styles.listIcon}><Ionicons name={icon} size={18} color={destructive ? colors.danger : colors.text} /></View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading" style={[{ fontSize: 16 }, destructive ? { color: colors.danger } : undefined]}>{title}</T>
        {subtitle ? <T variant="small" muted numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {right ?? (onPress && !destructive ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null)}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function DemoBanner() {
  return (
    <View style={styles.demo} accessibilityRole="alert">
      <T variant="label" style={{ color: colors.bg }}>DEMO MODE · SAMPLE DATA · ORDERING DISABLED</T>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: HIT, borderRadius: radius.pill, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    minHeight: HIT, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.lg, fontSize: 16,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md },
  listRow: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.md,
  },
  listIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  demo: { backgroundColor: colors.warning, paddingVertical: 4, alignItems: 'center' },
});

// ---------------------------------------------------------------------------------------------
// Loading skeletons: grey placeholder shapes that gently pulse while content loads, so screens
// keep their layout instead of showing a blank page with a spinner. Pulsing stops when the
// person has asked their device to reduce motion.
// ---------------------------------------------------------------------------------------------

function usePulse() {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]));
      loop.start();
    });
    return () => { cancelled = true; loop?.stop(); };
  }, [opacity]);
  return opacity;
}

/** One placeholder shape. */
export function Skeleton({ width = '100%', height = 14, radius: r = radius.sm, style }: {
  width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const opacity = usePulse();
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.surfaceRaised, opacity }, style]} />;
}

/** A list of card-shaped placeholders (search results, cravings, orders, comments…). */
export function SkeletonList({ rows = 5, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <View accessible accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap: space.md, paddingVertical: space.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: space.md }]}>
          {avatar ? <Skeleton width={44} height={44} radius={22} /> : null}
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width={i % 2 ? '55%' : '70%'} height={16} />
            <Skeleton width={i % 2 ? '80%' : '45%'} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Full-screen placeholder for a detail page (title, hero, a few rows). */
export function LoadingScreen() {
  return (
    <View accessible accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg }}>
      <Skeleton width="60%" height={26} />
      <Skeleton height={180} radius={radius.lg} />
      <Skeleton width="85%" />
      <Skeleton width="70%" />
      <SkeletonList rows={3} />
    </View>
  );
}

/** Feed placeholder: the shapes of a video page (caption + action rail). */
export function SkeletonFeed() {
  return (
    <View accessible accessibilityLabel="Loading videos" accessibilityRole="progressbar" style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ position: 'absolute', right: 12, bottom: 120, gap: space.lg, alignItems: 'center' }}>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width={36} height={36} radius={18} />)}
      </View>
      <View style={{ position: 'absolute', left: space.lg, right: 90, bottom: 32, gap: space.sm }}>
        <Skeleton width="45%" height={16} />
        <Skeleton width="90%" height={14} />
        <Skeleton width="65%" height={14} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Messages and status labels in one consistent style (colour + icon, never colour alone).
// ---------------------------------------------------------------------------------------------

const TONE_ICON: Record<Tone, ComponentProps<typeof Ionicons>['name']> = {
  info: 'information-circle', success: 'checkmark-circle', warning: 'alert-circle', danger: 'close-circle',
};

/** A message box: errors, confirmations, warnings, tips. Announced to screen readers. */
export function Notice({ tone = 'info', children, style }: { tone?: Tone; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = palette[tone];
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: p.soft, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: `${p.default}55` }, style]}>
      <Ionicons name={TONE_ICON[tone]} size={18} color={p.default} style={{ marginTop: 1 }} />
      <Text style={[font.small, { color: p.lightest, flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Small pill label, e.g. "Live", "In review", "Admin". */
export function Badge({ tone = 'info', label }: { tone?: Tone; label: string }) {
  const p = palette[tone];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: p.soft, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 }}>
      <Text style={[font.label, { color: p.lighter }]}>{label}</Text>
    </View>
  );
}
