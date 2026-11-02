import Ionicons from '@expo/vector-icons/Ionicons';
import { titleCase } from '@crave/core';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { Card, DemoBanner, Screen, T } from '@/components/ui';
import { getCoarseLocation, type Coarse } from '@/features/feed/location';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, font, HIT, radius, space } from '@/theme/tokens';

interface R {
  id: string; name: string; cuisines: string[]; priceLevel: number; halalCertified: boolean; suburb: string | null;
  distanceKm: number | null; isOpen: boolean; acceptingOrders: boolean; videoCount: number; matchedItems: string[];
}

export default function Discover() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState<Coarse | null>(null);
  const [items, setItems] = useState<R[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void getCoarseLocation().then(setLoc); }, []);

  const search = useCallback(async (term: string, where: Coarse) => {
    try {
      const params = new URLSearchParams({ lat: String(where.lat), lng: String(where.lng) });
      if (term.trim()) params.set('q', term.trim());
      setItems((await api<{ items: R[] }>(`/v1/restaurants?${params}`)).items);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Search failed'); }
  }, []);

  useEffect(() => {
    if (!loc || config.demoMode) return;
    const t = setTimeout(() => void search(q, loc), 300);
    return () => clearTimeout(t);
  }, [q, loc, search]);

  async function useMyLocation() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.granted) setLoc(await getCoarseLocation());
  }

  if (config.demoMode) {
    return <Screen padded={false}><DemoBanner /><View style={{ padding: space.lg, gap: space.sm }}><T variant="title">Discover</T><T muted>Restaurant search needs a CRAVE backend — not available in demo mode.</T></View></Screen>;
  }

  return (
    <Screen>
      <View style={{ gap: space.md, paddingTop: space.md }}>
        <T variant="title" accessibilityRole="header">Discover</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: HIT, gap: space.sm }}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Sushi, burgers, West End…" placeholderTextColor={colors.textFaint}
            style={{ flex: 1, color: colors.text, fontSize: 16 }} accessibilityLabel="Search restaurants and dishes" returnKeyType="search" autoCorrect={false} />
        </View>
        <Pressable accessibilityRole="button" onPress={useMyLocation} style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
          <Ionicons name="location-outline" size={16} color={colors.accent} />
          <T variant="small" style={{ color: colors.accent }}>{loc?.source === 'device' ? 'Near you' : 'Near Brisbane CBD — use my location'}</T>
        </Pressable>
      </View>
      {error ? <T style={{ color: colors.danger, marginTop: space.md }}>{error}</T> : null}
      {!items ? <ActivityIndicator style={{ marginTop: space.xl }} color={colors.accent} /> : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }}
          ListEmptyComponent={<T muted>No restaurants found{q ? ` for “${q}”` : ' nearby'}.</T>}
          renderItem={({ item: r }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/restaurant/${r.id}`)}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                  <T variant="heading" style={{ flex: 1 }}>{r.name}</T>
                  <T variant="small" style={{ color: r.isOpen && r.acceptingOrders ? colors.success : colors.textFaint }}>{r.isOpen ? (r.acceptingOrders ? 'Open' : 'Busy') : 'Closed'}</T>
                </View>
                <T variant="small" muted>
                  {r.cuisines.map(titleCase).join(', ')} · {'$'.repeat(r.priceLevel)} · {r.suburb}{r.distanceKm != null ? ` · ${r.distanceKm} km` : ''}
                </T>
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  {r.halalCertified ? <T variant="small" style={{ ...font.label, color: colors.success }}>HALAL CERTIFIED</T> : null}
                  {r.videoCount ? <T variant="small" style={{ ...font.label, color: colors.accent }}>{r.videoCount} VIDEO{r.videoCount > 1 ? 'S' : ''}</T> : null}
                </View>
                {r.matchedItems.length ? <T variant="small" muted>Matches: {r.matchedItems.slice(0, 3).join(', ')}</T> : null}
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
