import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, font, HIT, radius, space } from '@/theme/tokens';

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
          <Text style={[font.heading, { color: fg }]}>{title}</Text>
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
      {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}
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

export function ListRow({ title, subtitle, onPress, right, destructive }: {
  title: string; subtitle?: string; onPress?(): void; right?: ReactNode; destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading" style={destructive ? { color: colors.danger } : undefined}>{title}</T>
        {subtitle ? <T variant="small" muted>{subtitle}</T> : null}
      </View>
      {right}
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  demo: { backgroundColor: colors.warning, paddingVertical: 4, alignItems: 'center' },
});
