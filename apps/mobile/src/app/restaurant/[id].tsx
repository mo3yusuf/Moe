import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatAud } from '@/components/feed/format';
import { Notice } from '@/components/ui/Notice';
import { api, type RestaurantMenuResponse } from '@/lib/api';
import { colors, radius, space, type } from '@/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useQuery({ queryKey: ['restaurant', id], queryFn: () => api<RestaurantMenuResponse>(`/v1/restaurants/${id}`) });

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (error || !data) return <View style={styles.center}><Text style={styles.muted}>Restaurant not available.</Text></View>;
  const r = data.restaurant;
  const hours = DAYS.map((d, i) => ({ d, periods: r.hours.filter((h) => h.dayOfWeek === i) }));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 80 }}>
      <Stack.Screen options={{ title: r.name }} />
      {r.isDemo ? <Notice title="Demo restaurant" body="Fictional business used to test CRAVE." /> : null}
      <Text style={styles.title} accessibilityRole="header">{r.name}</Text>
      <Text style={styles.meta}>{r.cuisines.join(' · ')}{r.ratingAvg ? ` · ★ ${r.ratingAvg.toFixed(1)} (${r.ratingCount})` : ''}</Text>
      <Text style={styles.meta}>{r.location.address}</Text>
      <View style={styles.badges}>
        <Text style={[styles.badge, r.openNow ? styles.open : styles.closed]}>{r.openNow ? 'Open now' : 'Closed'}</Text>
        <Text style={styles.badge}>{r.pickupEnabled ? `Pickup · ~${r.avgPrepMinutes} min` : 'Pickup unavailable'}</Text>
        <Text style={styles.badge}>Delivery coming later</Text>
        {r.verifiedDietary.map((v) => <Text key={v} style={[styles.badge, { textTransform: 'capitalize' }]}>✓ {v.replace(/_/g, ' ')}</Text>)}
      </View>
      {r.description ? <Text style={styles.body}>{r.description}</Text> : null}

      {data.categories.map((c) => (
        <View key={c.id} style={{ marginTop: space.xl }}>
          <Text style={styles.section}>{c.name}</Text>
          {c.items.map((i) => (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              accessibilityLabel={`${i.name}, ${formatAud(i.priceCents)}${i.available ? '' : ', sold out'}`}
              onPress={() => router.push({ pathname: '/meal/[id]', params: { id: i.id } })}
              style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, !i.available && { color: colors.textDim }]}>{i.name}</Text>
                {i.description ? <Text style={styles.itemDesc} numberOfLines={2}>{i.description}</Text> : null}
                <Text style={styles.itemPrice}>{formatAud(i.priceCents)}{i.available ? '' : ' · Sold out'}</Text>
              </View>
              {i.videoIds.length ? <Text style={styles.videoTag}>▶ {i.videoIds.length}</Text> : null}
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={[styles.section, { marginTop: space.xl }]}>Opening hours</Text>
      {hours.map((h) => (
        <View key={h.d} style={styles.hoursRow}>
          <Text style={styles.hoursDay}>{h.d}</Text>
          <Text style={styles.hoursTime}>{h.periods.length ? h.periods.map((p) => `${p.opensAt}–${p.closesAt}`).join(', ') : 'Closed'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { ...type.body, color: colors.textMuted },
  title: { ...type.display, color: colors.text },
  meta: { ...type.body, color: colors.textMuted, marginTop: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.md },
  badge: { ...type.caption, fontWeight: '600', color: colors.text, backgroundColor: colors.surfaceRaised, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden' },
  open: { backgroundColor: 'rgba(34,197,94,0.18)', color: colors.success },
  closed: { color: colors.textMuted },
  body: { ...type.body, color: colors.textMuted, marginTop: space.md },
  section: { ...type.label, color: colors.textMuted, marginBottom: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: space.md },
  itemName: { ...type.bodyStrong, color: colors.text },
  itemDesc: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  itemPrice: { ...type.bodyStrong, color: colors.text, marginTop: 4 },
  videoTag: { ...type.caption, color: colors.accent, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  hoursDay: { ...type.body, color: colors.text },
  hoursTime: { ...type.body, color: colors.textMuted },
});
