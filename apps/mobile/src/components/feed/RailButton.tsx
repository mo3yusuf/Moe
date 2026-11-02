import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/theme';

export function RailButton({ icon, label, count, active, activeColor = colors.accent, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count?: string;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ selected: !!active }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && { transform: [{ scale: 0.9 }] }]}>
      <Ionicons name={icon} size={30} color={active ? activeColor : colors.text} style={styles.shadow} />
      <Text style={styles.count}>{count ?? label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', marginBottom: 18, minWidth: 48 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  count: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 3, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
