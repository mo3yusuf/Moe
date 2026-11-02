import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, type } from '@/theme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}>
      <Text style={[styles.text, selected && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8, marginBottom: 8 },
  selected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  text: { ...type.caption, fontWeight: '600', color: colors.textMuted },
});
