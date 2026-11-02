import { lineUnitTotal } from '@crave/core';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatAud } from '@/components/feed/format';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { api, type MenuItemResponse, type ModifierGroup } from '@/lib/api';
import { colors, radius, space, type } from '@/theme';

const SPICE = ['No heat', 'Mild', 'Medium', 'Hot', 'Very hot'];

function defaultSelection(groups: ModifierGroup[]): Record<string, string[]> {
  return Object.fromEntries(groups.map((g) => [g.id, g.options.filter((o) => o.isDefault && o.available).map((o) => o.id).slice(0, g.maxSelect)]));
}

export default function MealScreen() {
  const { id } = useLocalSearchParams<{ id: string; video?: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useQuery({ queryKey: ['menu-item', id], queryFn: () => api<MenuItemResponse>(`/v1/menu-items/${id}`) });
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (data) setSelected(defaultSelection(data.item.modifierGroups));
  }, [data]);

  const groups = data?.item.modifierGroups ?? [];
  const missing = groups.filter((g) => (selected[g.id]?.length ?? 0) < g.minSelect);
  const unit = useMemo(() => {
    if (!data) return 0;
    const opts = groups.flatMap((g) => g.options.filter((o) => selected[g.id]?.includes(o.id)));
    return lineUnitTotal({ menuItemId: data.item.id, name: data.item.name, unitPriceCents: data.item.priceCents, quantity: 1, options: opts.map((o) => ({ optionId: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents })) });
  }, [data, groups, selected]);

  function toggle(g: ModifierGroup, optionId: string) {
    setSelected((s) => {
      const cur = s[g.id] ?? [];
      if (cur.includes(optionId)) return { ...s, [g.id]: cur.filter((x) => x !== optionId) };
      if (g.maxSelect === 1) return { ...s, [g.id]: [optionId] };
      if (cur.length >= g.maxSelect) return s;
      return { ...s, [g.id]: [...cur, optionId] };
    });
  }

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (error || !data) return <View style={styles.center}><Text style={styles.muted}>{error instanceof Error ? error.message : 'This dish isn’t available.'}</Text></View>;

  const { item, restaurant } = data;
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {restaurant.isDemo ? <Notice title="Demo restaurant" body="This is fictional demo data for testing CRAVE. No real food will be prepared." /> : null}
        <Text style={styles.title} accessibilityRole="header">{item.name}</Text>
        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: restaurant.id } })}>
          <Text style={styles.restaurant}>{restaurant.name} · {restaurant.location.suburb} {restaurant.openNow ? '· Open now' : '· Closed'}</Text>
        </Pressable>
        <Text style={styles.price}>{formatAud(item.priceCents)}</Text>
        {item.description ? <Text style={styles.body}>{item.description}</Text> : null}

        <View style={styles.tags}>
          {item.dietary.map((d) => <Text key={d} style={styles.tag}>{d.replace(/_/g, ' ')}</Text>)}
          {item.spiceLevel !== null ? <Text style={styles.tag}>🌶 {SPICE[item.spiceLevel]}</Text> : null}
        </View>
        {item.allergens.length ? (
          <Text style={styles.allergens}>Contains (as declared by the restaurant): {item.allergens.join(', ')}. If you have an allergy, confirm with the restaurant before ordering.</Text>
        ) : null}

        {groups.map((g) => (
          <View key={g.id} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{g.name}</Text>
              <Text style={styles.groupRule}>{g.minSelect > 0 ? 'Required' : 'Optional'}{g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ''}</Text>
            </View>
            {g.options.map((o) => {
              const on = selected[g.id]?.includes(o.id) ?? false;
              return (
                <Pressable
                  key={o.id}
                  disabled={!o.available}
                  accessibilityRole={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked: on, disabled: !o.available }}
                  accessibilityLabel={`${o.name}${o.priceDeltaCents ? `, plus ${formatAud(o.priceDeltaCents)}` : ''}`}
                  onPress={() => toggle(g, o.id)}
                  style={styles.option}>
                  <Ionicons name={on ? (g.maxSelect === 1 ? 'radio-button-on' : 'checkbox') : g.maxSelect === 1 ? 'radio-button-off' : 'square-outline'} size={22} color={on ? colors.accent : colors.textDim} />
                  <Text style={[styles.optionName, !o.available && { color: colors.textDim }]}>{o.name}{!o.available ? ' (sold out)' : ''}</Text>
                  {o.priceDeltaCents ? <Text style={styles.optionPrice}>+{formatAud(o.priceDeltaCents)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Notice tone="warning" title="Checkout is not built yet" body="Basket, pickup checkout and payments arrive in Phase 5. Prices shown are live from the restaurant’s menu." />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.qty}>
          <Pressable accessibilityLabel="Decrease quantity" onPress={() => setQty((q) => Math.max(1, q - 1))} hitSlop={8}><Ionicons name="remove-circle-outline" size={30} color={colors.text} /></Pressable>
          <Text style={styles.qtyText} accessibilityLabel={`Quantity ${qty}`}>{qty}</Text>
          <Pressable accessibilityLabel="Increase quantity" onPress={() => setQty((q) => Math.min(50, q + 1))} hitSlop={8}><Ionicons name="add-circle-outline" size={30} color={colors.text} /></Pressable>
        </View>
        <Button
          size="lg"
          style={{ flex: 1 }}
          disabled
          label={!data.orderable ? data.notOrderableReason ?? 'Unavailable' : missing.length ? `Choose ${missing[0]!.name}` : `Add · ${formatAud(unit * qty)} (Phase 5)`}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: space.xl },
  muted: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  title: { ...type.display, color: colors.text },
  restaurant: { ...type.bodyStrong, color: colors.textMuted, marginTop: 6 },
  price: { ...type.title, color: colors.text, marginTop: space.md },
  body: { ...type.body, color: colors.textMuted, marginTop: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.md },
  tag: { ...type.caption, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, textTransform: 'capitalize', overflow: 'hidden' },
  allergens: { ...type.caption, color: colors.textMuted, marginTop: space.md, lineHeight: 18 },
  group: { marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm },
  groupTitle: { ...type.heading, color: colors.text },
  groupRule: { ...type.caption, color: colors.textMuted },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  optionName: { ...type.body, color: colors.text, flex: 1 },
  optionPrice: { ...type.bodyStrong, color: colors.textMuted },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingBottom: space.xl, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyText: { ...type.heading, color: colors.text, minWidth: 20, textAlign: 'center' },
});
