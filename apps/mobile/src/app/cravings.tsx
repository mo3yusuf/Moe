import { formatMoney } from '@crave/core';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Card, LoadingScreen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, space } from '@/theme/tokens';

interface Saved {
  videoId: string | null; menuItemId: string | null; savedAt: string;
  menuItemName: string | null; priceCents: number | null; currency: string | null; restaurantName: string | null; isAvailable: boolean;
}

/** Meals the user swiped right on ("Crave it"). */
export default function Cravings() {
  const [items, setItems] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config.demoMode) { setItems([]); return; }
    api<{ items: Saved[] }>('/v1/saved?collection=cravings').then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);

  if (!items && !error) return <LoadingScreen />;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={items ?? []}
      keyExtractor={(i, idx) => `${i.videoId}-${i.menuItemId}-${idx}`}
      ListEmptyComponent={
        <View style={{ gap: space.sm, paddingTop: space.xl }}>
          <T variant="heading">{error ? 'Couldn’t load your Cravings' : 'No Cravings yet'}</T>
          <T muted>{error ?? (config.demoMode ? 'Cravings are saved to your account — not available in demo mode.' : 'Swipe right on a video (or tap Crave it) to save the meal here.')}</T>
        </View>
      }
      renderItem={({ item }) => (
        <Card>
          <T variant="heading">{item.menuItemName ?? 'Video'}</T>
          {item.restaurantName ? <T muted>{item.restaurantName}</T> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {item.priceCents != null ? <T variant="heading">{formatMoney(item.priceCents, item.currency ?? 'AUD')}</T> : <View />}
            {!item.isAvailable && item.menuItemId ? <T variant="small" style={{ color: colors.warning }}>Currently unavailable</T> : null}
          </View>
        </Card>
      )}
    />
  );
}
