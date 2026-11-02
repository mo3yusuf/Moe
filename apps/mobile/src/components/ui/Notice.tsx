import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '@/theme';

/** Honest status banner — used for demo content and features not built yet. */
export function Notice({ tone = 'info', title, body }: { tone?: 'info' | 'warning'; title: string; body?: string }) {
  return (
    <View accessibilityRole="summary" style={[styles.box, tone === 'warning' && { borderColor: colors.accent }]}>
      <Ionicons name={tone === 'warning' ? 'construct-outline' : 'information-circle-outline'} size={20} color={tone === 'warning' ? colors.accent : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: space.lg },
  title: { ...type.bodyStrong, color: colors.text },
  body: { ...type.caption, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
});
