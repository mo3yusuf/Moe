import { ALLERGEN_LABELS, DIETARY_LABELS, formatMoney, validateSelection, type Allergen, type DietaryTag, type ItemDef } from '@crave/core';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Field, T } from '@/components/ui';
import { track } from '@/features/feed/events';
import { api, ApiRequestError } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, HIT, radius, space } from '@/theme/tokens';

interface Detail extends ItemDef {
  restaurantId: string; restaurantName: string; description: string | null; currency: string; imageUrl: string | null;
  dietaryTags: string[]; allergens: string[]; spiceLevel: number | null; orderable: boolean;
}

/** Order This Meal: exact menu item, live price, valid customisations only. */
export default function ItemScreen() {
  const { id, video } = useLocalSearchParams<{ id: string; video?: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Detail>(`/v1/menu-items/${id}`).then((d) => {
      setItem(d);
      // Preselect the first option of required single-choice groups.
      setSelected(d.optionGroups.filter((g) => g.minSelect === 1 && g.maxSelect === 1).flatMap((g) => g.options.find((o) => o.isAvailable)?.id ?? []));
    }).catch((e) => setError(e.message));
    if (video) track({ kind: 'interaction', eventType: 'menu_item_click', videoId: video, menuItemId: id });
  }, [id, video]);

  const errors = useMemo(() => (item ? validateSelection(item, selected) : []), [item, selected]);
  const unit = item ? item.priceCents + item.optionGroups.flatMap((g) => g.options).filter((o) => selected.includes(o.id)).reduce((a, o) => a + o.priceDeltaCents, 0) : 0;

  function toggle(groupId: string, optionId: string) {
    const g = item!.optionGroups.find((x) => x.id === groupId)!;
    setSelected((cur) => {
      if (cur.includes(optionId)) return cur.filter((x) => x !== optionId);
      const inGroup = cur.filter((x) => g.options.some((o) => o.id === x));
      if (g.maxSelect === 1) return [...cur.filter((x) => !inGroup.includes(x)), optionId];
      return inGroup.length >= g.maxSelect ? cur : [...cur, optionId];
    });
  }

  async function add(replaceBasket = false) {
    setBusy(true);
    try {
      await api('/v1/basket/items', { body: { menuItemId: id, quantity: qty, optionIds: selected, notes: notes || null, sourceVideoId: video ?? null, replaceBasket } });
      if (video) track({ kind: 'interaction', eventType: 'add_to_basket', videoId: video, menuItemId: id });
      router.replace('/basket');
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'basket_conflict') {
        Alert.alert('Start a new basket?', e.message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Start new basket', style: 'destructive', onPress: () => add(true) }]);
      } else Alert.alert('Couldn’t add to basket', e instanceof Error ? e.message : 'Please try again');
    } finally { setBusy(false); }
  }

  if (!item) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>{error ? <T muted>{error}</T> : <ActivityIndicator color={colors.accent} />}</View>;

  return (
    <>
      <Stack.Screen options={{ title: item.restaurantName }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}>
        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: '100%', aspectRatio: 1.4, borderRadius: radius.lg }} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
        <View style={{ gap: space.xs }}>
          <T variant="title">{item.name}</T>
          <T variant="heading">{formatMoney(item.priceCents, item.currency)}</T>
          {item.description ? <T muted>{item.description}</T> : null}
          {item.dietaryTags.length ? <T variant="small" muted>{item.dietaryTags.map((t) => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')} (as declared by the restaurant)</T> : null}
          {item.allergens.length ? <T variant="small" style={{ color: colors.warning }}>Contains: {item.allergens.map((a) => ALLERGEN_LABELS[a as Allergen] ?? a).join(', ')} (declared by the restaurant). Always confirm with the restaurant if you have an allergy.</T> : null}
        </View>
        {item.optionGroups.map((g) => (
          <Card key={g.id}>
            <T variant="heading">{g.name}</T>
            <T variant="small" muted>{g.minSelect > 0 ? (g.maxSelect === 1 ? 'Required · choose 1' : `Required · choose ${g.minSelect}–${g.maxSelect}`) : `Optional · up to ${g.maxSelect}`}</T>
            {g.options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <Pressable key={o.id} disabled={!o.isAvailable} onPress={() => toggle(g.id, o.id)}
                  accessibilityRole={g.maxSelect === 1 ? 'radio' : 'checkbox'} accessibilityState={{ checked: on, disabled: !o.isAvailable }}
                  style={{ minHeight: HIT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: o.isAvailable ? 1 : 0.4 }}>
                  <T>{on ? '● ' : '○ '}{o.name}{o.isAvailable ? '' : ' (unavailable)'}</T>
                  {o.priceDeltaCents ? <T muted>+{formatMoney(o.priceDeltaCents)}</T> : null}
                </Pressable>
              );
            })}
          </Card>
        ))}
        <Field label="Notes for the kitchen (optional)" value={notes} onChangeText={setNotes} maxLength={200} placeholder="e.g. no onions" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
          <Button title="−" variant="secondary" onPress={() => setQty((q) => Math.max(1, q - 1))} accessibilityLabel="Decrease quantity" />
          <T variant="title" accessibilityLabel={`Quantity ${qty}`}>{qty}</T>
          <Button title="+" variant="secondary" onPress={() => setQty((q) => Math.min(50, q + 1))} accessibilityLabel="Increase quantity" />
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, gap: space.xs }}>
        {!config.orderingEnabled ? <T variant="small" muted style={{ textAlign: 'center' }}>Ordering through CRAVE is coming soon.</T>
          : !item.orderable ? <T variant="small" style={{ color: colors.warning, textAlign: 'center' }}>This restaurant isn’t taking orders right now.</T> : errors[0] ? <T variant="small" muted style={{ textAlign: 'center' }}>{errors[0].message}</T> : null}
        <Button title={config.orderingEnabled ? `Add ${qty} to basket · ${formatMoney(unit * qty, item.currency)}` : 'Ordering coming soon'} onPress={() => add()} loading={busy}
          disabled={!config.orderingEnabled || !!errors.length || !item.orderable} />
      </View>
    </>
  );
}
