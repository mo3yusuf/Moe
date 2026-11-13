import Ionicons from '@expo/vector-icons/Ionicons';
import { activeGroups, ALLERGEN_LABELS, countSelection, DIETARY_LABELS, formatMoney, unitPriceCents, validateSelection, type Allergen, type DietaryTag, type ItemDef, type OptionDef, type OptionGroupDef } from '@crave/core';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Badge, Button, Card, Field, LoadingScreen, Notice, T } from '@/components/ui';
import { track } from '@/features/feed/events';
import { api, ApiRequestError } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, font, HIT, palette, radius, space } from '@/theme/tokens';

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
      // Preselect the first available option of required single-choice (top-level) groups.
      setSelected(d.optionGroups.filter((g) => !g.parentOptionId && g.minSelect === 1 && g.maxSelect === 1).flatMap((g) => g.options.find((o) => o.isAvailable)?.id ?? []));
    }).catch((e) => setError(e.message));
    if (video) track({ kind: 'interaction', eventType: 'menu_item_click', videoId: video, menuItemId: id });
  }, [id, video]);

  const errors = useMemo(() => (item ? validateSelection(item, selected) : []), [item, selected]);
  const unit = item ? unitPriceCents(item, selected) : 0;
  const counts = useMemo(() => countSelection(selected), [selected]);
  const groups = useMemo(() => (item ? activeGroups(item, selected) : []), [item, selected]);

  /** Apply a change, then drop picks from nested groups whose parent option is no longer chosen. */
  function update(next: (cur: string[]) => string[]) {
    setSelected((cur) => {
      let out = next(cur);
      for (let i = 0; i < 4; i++) {
        const live = new Set(activeGroups(item!, out).flatMap((g) => g.options.map((o) => o.id)));
        const pruned = out.filter((x) => live.has(x));
        if (pruned.length === out.length) break;
        out = pruned;
      }
      return out;
    });
  }
  const groupTotal = (g: OptionGroupDef, cur: string[]) => cur.filter((x) => g.options.some((o) => o.id === x)).length;

  /** Tap an option: radio groups swap; otherwise toggle on/off (quantity options use the stepper). */
  function tap(g: OptionGroupDef, o: OptionDef) {
    update((cur) => {
      if (cur.includes(o.id) && (o.maxQuantity ?? 1) === 1) return cur.filter((x) => x !== o.id);
      if (g.maxSelect === 1) return [...cur.filter((x) => !g.options.some((p) => p.id === x)), o.id];
      if (cur.includes(o.id)) return cur;
      return groupTotal(g, cur) >= g.maxSelect ? cur : [...cur, o.id];
    });
  }
  function step(g: OptionGroupDef, o: OptionDef, delta: 1 | -1) {
    update((cur) => {
      if (delta < 0) { const i = cur.lastIndexOf(o.id); return i < 0 ? cur : [...cur.slice(0, i), ...cur.slice(i + 1)]; }
      const n = cur.filter((x) => x === o.id).length;
      if (n >= (o.maxQuantity ?? 1) || groupTotal(g, cur) >= g.maxSelect) return cur;
      return [...cur, o.id];
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

  if (!item) return (error ? <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}><Notice tone="danger">{error}</Notice></View> : <LoadingScreen />);

  return (
    <>
      <Stack.Screen options={{ title: item.restaurantName }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}>
        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: '100%', aspectRatio: 1.4, borderRadius: radius.lg }} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
        <View style={{ gap: space.xs }}>
          {item.isCombo ? <Badge tone="warning" label="MEAL DEAL" /> : null}
          <T variant="title">{item.name}</T>
          <T variant="heading">{formatMoney(item.priceCents, item.currency)}</T>
          {item.description ? <T muted>{item.description}</T> : null}
          {item.dietaryTags.length ? <T variant="small" muted>{item.dietaryTags.map((t) => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')} (as declared by the restaurant)</T> : null}
          {item.allergens.length ? <T variant="small" style={{ color: colors.warning }}>Contains: {item.allergens.map((a) => ALLERGEN_LABELS[a as Allergen] ?? a).join(', ')} (declared by the restaurant). Always confirm with the restaurant if you have an allergy.</T> : null}
        </View>
        {groups.map((g) => (
          <OptionGroupCard key={g.id} group={g} counts={counts} nested={!!g.parentOptionId}
            onTap={(o) => tap(g, o)} onStep={(o, d) => step(g, o, d)} />
        ))}
        <Field label="Notes for the kitchen (optional)" value={notes} onChangeText={setNotes} maxLength={200} placeholder="e.g. sauce on the side" />
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

/** One customisation group, Uber Eats style: list rows (with photos and quantity steppers), chips, or
 * "remove ingredients" chips that cross the ingredient out when tapped. */
function OptionGroupCard({ group: g, counts, nested, onTap, onStep }: {
  group: OptionGroupDef; counts: Map<string, number>; nested: boolean;
  onTap(o: OptionDef): void; onStep(o: OptionDef, delta: 1 | -1): void;
}) {
  const picked = g.options.reduce((a, o) => a + (counts.get(o.id) ?? 0), 0);
  const required = g.minSelect > 0;
  const satisfied = picked >= g.minSelect;
  const rule = g.displayStyle === 'remove' ? 'Tap to remove'
    : g.maxSelect === 1 ? 'Choose 1'
    : g.minSelect > 0 ? `Choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}`
    : `Up to ${g.maxSelect}`;
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {nested ? <Ionicons name="return-down-forward" size={16} color={colors.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <T variant="heading">{g.displayStyle === 'remove' && !/remove/i.test(g.name) ? `Remove: ${g.name}` : g.name}</T>
        <T variant="small" muted>{rule}{g.maxSelect > 1 && g.displayStyle !== 'remove' ? ` · ${picked} picked` : ''}</T>
      </View>
      {required ? <Badge tone={satisfied ? 'success' : 'warning'} label={satisfied ? '✓ Done' : 'Required'} /> : <Badge tone="info" label="Optional" />}
    </View>
  );

  if (g.displayStyle === 'chips' || g.displayStyle === 'remove') {
    const removing = g.displayStyle === 'remove';
    return (
      <Card style={nested ? { marginLeft: space.md } : undefined}>
        {header}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {g.options.map((o) => {
            const on = (counts.get(o.id) ?? 0) > 0;
            return (
              <Pressable key={o.id} disabled={!o.isAvailable} onPress={() => onTap(o)}
                accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !o.isAvailable }}
                accessibilityLabel={removing ? `${on ? 'Removed' : 'Remove'} ${o.name}` : o.name}
                style={[styles.chip, on && (removing ? styles.chipRemoved : styles.chipOn), !o.isAvailable && { opacity: 0.4 }]}>
                {removing ? <Ionicons name={on ? 'close-circle' : 'remove-circle-outline'} size={16} color={on ? palette.danger.lighter : colors.textMuted} /> : null}
                <Text style={[font.small, { color: colors.text, fontWeight: '600' }, removing && on && styles.strike]}>{o.name}</Text>
                {o.priceDeltaCents ? <Text style={[font.label, { color: colors.textMuted }]}>+{formatMoney(o.priceDeltaCents)}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>
    );
  }

  return (
    <Card style={nested ? { marginLeft: space.md } : undefined}>
      {header}
      {g.options.map((o) => {
        const n = counts.get(o.id) ?? 0;
        const multi = (o.maxQuantity ?? 1) > 1;
        // Quantity options are a plain row (the stepper buttons do the work); others are tappable rows.
        const Row = multi ? View : Pressable;
        const rowProps = multi ? {} : {
          disabled: !o.isAvailable, onPress: () => onTap(o),
          accessibilityRole: (g.maxSelect === 1 ? 'radio' : 'checkbox') as 'radio' | 'checkbox',
          accessibilityState: { checked: n > 0, disabled: !o.isAvailable },
        };
        return (
          <Row key={o.id} {...rowProps} style={[styles.row, !o.isAvailable && { opacity: 0.4 }]}>
            {o.imageUrl ? <Image source={{ uri: o.imageUrl }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            {!multi ? (
              <Ionicons name={g.maxSelect === 1 ? (n ? 'radio-button-on' : 'radio-button-off') : (n ? 'checkbox' : 'square-outline')}
                size={22} color={n ? colors.accent : colors.textMuted} />
            ) : null}
            <View style={{ flex: 1 }}>
              <T>{o.name}{o.isAvailable ? '' : ' · sold out'}</T>
              {o.priceDeltaCents ? <T variant="small" muted>{o.priceDeltaCents > 0 ? '+' : ''}{formatMoney(o.priceDeltaCents)}{multi ? ' each' : ''}</T> : null}
            </View>
            {multi && o.isAvailable ? (
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel={`One less ${o.name}`} disabled={n === 0} onPress={() => onStep(o, -1)} hitSlop={8}
                  style={[styles.stepBtn, n === 0 && { opacity: 0.35 }]}>
                  <Ionicons name="remove" size={18} color={colors.text} />
                </Pressable>
                <Text accessibilityLabel={`${n} ${o.name}`} style={[font.heading, { color: colors.text, minWidth: 20, textAlign: 'center' }]}>{n}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`One more ${o.name}`} disabled={n >= (o.maxQuantity ?? 1)} onPress={() => onStep(o, 1)} hitSlop={8}
                  style={[styles.stepBtn, n >= (o.maxQuantity ?? 1) && { opacity: 0.35 }]}>
                  <Ionicons name="add" size={18} color={colors.text} />
                </Pressable>
              </View>
            ) : null}
          </Row>
        );
      })}
    </Card>
  );
}

const styles = {
  row: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: space.md } as const,
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 4, paddingVertical: 2 } as const,
  stepBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' } as const,
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border } as const,
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipRemoved: { borderColor: palette.danger.default, backgroundColor: palette.danger.soft },
  strike: { textDecorationLine: 'line-through' } as const,
};
