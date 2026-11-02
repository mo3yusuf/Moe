import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, type } from '@/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, variant = 'primary', loading, size = 'md', disabled, style, ...rest }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        styles[variant],
        pressed && variant === 'primary' && { backgroundColor: colors.accentPressed },
        pressed && variant !== 'primary' && { opacity: 0.75 },
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.text : colors.accent} />
      ) : (
        <Text style={[styles.label, variant === 'ghost' && { color: colors.accent }, variant === 'secondary' && { color: colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: radius.pill, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  lg: { minHeight: 56 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  label: { ...type.bodyStrong, color: colors.text },
});
