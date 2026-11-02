import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '@/theme/tokens';

export function Chip({ label, selected, tone = 'accent', onPress }: { label: string; selected: boolean; tone?: 'accent' | 'danger'; onPress(): void }) {
  const bg = selected ? (tone === 'danger' ? colors.danger : colors.accent) : colors.surfaceRaised;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={[font.small, { color: colors.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: { minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.pill, justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
