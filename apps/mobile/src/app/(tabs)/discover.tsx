import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatAud } from '@/components/feed/format';
import { Notice } from '@/components/ui/Notice';
import { Screen, Section } from '@/components/ui/Screen';
import { fetchFeed, type FeedItem } from '@/lib/api';
import { newId } from '@/lib/events';
import { useCoarseLocation } from '@/lib/location';
import { colors, radius, space, type } from '@/theme';

function MealRow({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.meal?.name ?? item.caption}${item.restaurant ? ` at ${item.restaurant.name}` : ''}`} onPress={onPress} style={styles.row}>
      <View style={styles.thumb}><Ionicons name="play" size={18} color={colors.text} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.meal?.name ?? item.caption}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.restaurant ? `${item.restaurant.name}${item.restaurant.distanceKm !== null ? ` · ${item.restaurant.distanceKm} km` : ''}` : 'Food video'}
        </Text>
      </View>
      {item.meal ? <Text style={styles.rowPrice}>{formatAud(item.meal.priceCents)}</Text> : null}
    </Pressable>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { location, status } = useCoarseLocation();
  const session = useMemo(() => newId(), []);
  const [query, setQuery] = useState('');
  const nearby = useQuery({ queryKey: ['nearby', location.lat, location.lng], queryFn: () => fetchFeed({ kind: 'nearby', session, limit: 10, lat: location.lat, lng: location.lng }) });
  const trending = useQuery({ queryKey: ['trending'], queryFn: () => fetchFeed({ kind: 'trending', session, limit: 10 }) });

  const filter = (items: FeedItem[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.meal?.name, i.restaurant?.name, i.caption, ...i.hashtags].some((s) => s?.toLowerCase().includes(q)));
  };
  const open = (i: FeedItem) => (i.meal ? router.push({ pathname: '/meal/[id]', params: { id: i.meal.menuItemId } }) : undefined);

  return (
    <Screen title="Discover" subtitle={status === 'granted' ? 'Trending food near you' : 'Trending food in Brisbane'}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput accessibilityLabel="Filter meals and restaurants" value={query} onChangeText={setQuery} placeholder="Filter burgers, sushi, restaurants…" placeholderTextColor={colors.textDim} style={styles.searchInput} />
      </View>
      {status === 'denied' ? <Notice title="Location off" body="Showing distances from Brisbane CBD. Enable location to see what’s closest to you." /> : null}

      <Section title="Order now · nearby">
        {nearby.isLoading ? <ActivityIndicator color={colors.accent} /> : null}
        {nearby.error ? <Text style={styles.rowMeta}>Couldn’t load nearby meals.</Text> : null}
        {filter(nearby.data?.items ?? []).map((i) => <MealRow key={i.videoId} item={i} onPress={() => open(i)} />)}
        {nearby.data && nearby.data.items.length === 0 ? <Text style={styles.rowMeta}>No restaurants are taking orders nearby right now.</Text> : null}
      </Section>

      <Section title="Trending in Brisbane">
        {trending.isLoading ? <ActivityIndicator color={colors.accent} /> : null}
        {filter(trending.data?.items ?? []).map((i) => <MealRow key={i.videoId} item={i} onPress={() => open(i)} />)}
      </Section>
      <Text style={styles.rowMeta}>Full search (menus, cuisines, creators) is planned for a later phase; this box filters the lists above.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 46, marginBottom: space.lg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  thumb: { width: 44, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  rowPrice: { ...type.bodyStrong, color: colors.text },
});
