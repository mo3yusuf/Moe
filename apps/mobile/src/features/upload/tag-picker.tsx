import { formatMoney } from '@crave/core';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Card, Field, T } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, space } from '@/theme/tokens';

interface R { id: string; name: string; suburb: string | null }
interface M { menuItemId: string; name: string; priceCents: number; currency: string }
export interface TagChoice { restaurantId: string; restaurantName: string; menuItemId: string; menuItemName: string }

/** Two-step picker: restaurant (verified only), then a menu item. */
export function TagPicker({ value, onChange }: { value: TagChoice | null; onChange(v: TagChoice | null): void }) {
  const [q, setQ] = useState('');
  const [restaurants, setRestaurants] = useState<R[]>([]);
  const [chosen, setChosen] = useState<R | null>(null);
  const [menu, setMenu] = useState<M[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (chosen || q.trim().length < 2) { setRestaurants([]); return; }
    const t = setTimeout(() => {
      setLoading(true);
      api<{ items: R[] }>(`/v1/restaurants?q=${encodeURIComponent(q.trim())}&maxKm=50`).then((r) => setRestaurants(r.items.slice(0, 8))).catch(() => {}).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, chosen]);

  useEffect(() => {
    if (!chosen) return;
    api<{ menu: M[] }>(`/v1/restaurants/${chosen.id}`).then((d) => setMenu(d.menu)).catch(() => setMenu([]));
  }, [chosen]);

  if (value) {
    return (
      <Card>
        <T variant="heading">{value.menuItemName}</T>
        <T muted>{value.restaurantName} · the restaurant must approve this tag before it can be ordered from your video</T>
        <Pressable accessibilityRole="button" onPress={() => { onChange(null); setChosen(null); setMenu(null); }}><T style={{ color: colors.accent }}>Change</T></Pressable>
      </Card>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {!chosen ? (
        <>
          <Field label="Tag a restaurant (optional)" value={q} onChangeText={setQ} placeholder="Search restaurant or dish" autoCorrect={false} />
          {loading ? <ActivityIndicator color={colors.accent} /> : null}
          {restaurants.map((r) => (
            <Pressable key={r.id} accessibilityRole="button" onPress={() => setChosen(r)} style={{ paddingVertical: space.sm }}>
              <T>{r.name}</T><T variant="small" muted>{r.suburb}</T>
            </Pressable>
          ))}
          {q.trim().length >= 2 && !loading && !restaurants.length ? <T variant="small" muted>Only verified CRAVE restaurants can be tagged.</T> : null}
        </>
      ) : (
        <>
          <T variant="heading">Which dish from {chosen.name}?</T>
          {!menu ? <ActivityIndicator color={colors.accent} /> : menu.map((m) => (
            <Pressable key={m.menuItemId} accessibilityRole="button" style={{ paddingVertical: space.sm, flexDirection: 'row', justifyContent: 'space-between' }}
              onPress={() => onChange({ restaurantId: chosen.id, restaurantName: chosen.name, menuItemId: m.menuItemId, menuItemName: m.name })}>
              <T>{m.name}</T><T muted>{formatMoney(m.priceCents, m.currency)}</T>
            </Pressable>
          ))}
          <Pressable onPress={() => { setChosen(null); setMenu(null); }}><T style={{ color: colors.accent }}>← Choose another restaurant</T></Pressable>
        </>
      )}
    </View>
  );
}
