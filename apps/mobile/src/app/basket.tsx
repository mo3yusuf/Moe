import { formatMoney } from '@crave/core';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Button, Card, Field, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

interface Line { id: string; name: string; quantity: number; options: string[]; notes: string | null; unitPriceCents: number | null; issue: string | null }
interface BasketResponse {
  basket: { restaurantName: string; lines: Line[] } | null;
  quote?: { subtotalCents: number; serviceFeeCents: number; totalCents: number; gstCents: number; currency: string } | null;
  location?: { isOpen: boolean; acceptingOrders: boolean; pickupEnabled: boolean; prepTimeMinutes: number } | null;
  canCheckout?: boolean;
}

export default function BasketScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<BasketResponse | null>(null);
  const [pickupName, setPickupName] = useState(String(session?.user.user_metadata?.display_name ?? '').split(' ')[0] ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // One idempotency key per checkout attempt: double taps / retries can never create two orders.
  const idempotencyKey = useRef(Crypto.randomUUID());

  const load = useCallback(() => { api<BasketResponse>('/v1/basket').then(setData).catch((e) => Alert.alert('Couldn’t load basket', e.message)); }, []);
  useFocusEffect(load);

  async function setQty(line: Line, quantity: number) {
    if (quantity < 1) await api(`/v1/basket/items/${line.id}`, { method: 'DELETE' });
    else await api(`/v1/basket/items/${line.id}`, { method: 'PATCH', body: { quantity } });
    load();
  }

  async function checkout() {
    setBusy(true);
    try {
      const res = await api<{ order: { id: string; totalCents: number }; payment: { mode: string } }>('/v1/checkout', {
        body: { pickupName, note: note || null, idempotencyKey: idempotencyKey.current },
      });
      idempotencyKey.current = Crypto.randomUUID();
      if (res.payment.mode === 'simulated') router.replace({ pathname: '/pay/[id]', params: { id: res.order.id, total: String(res.order.totalCents) } });
      else Alert.alert('Payments', 'Card payments are not enabled yet.');
    } catch (e) {
      Alert.alert('Couldn’t place order', e instanceof Error ? e.message : 'Please try again');
      load();
    } finally { setBusy(false); }
  }

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  if (!data.basket) return <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md }}><T variant="heading">Your basket is empty</T><T muted>Tap “Order now” on a video or open a restaurant’s menu.</T></View>;
  const q = data.quote;
  const loc = data.location;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T variant="title">{data.basket.restaurantName}</T>
      <T muted>Pickup{loc ? ` · ready in about ${loc.prepTimeMinutes} min after the restaurant accepts` : ''}</T>
      {loc && !(loc.isOpen && loc.acceptingOrders && loc.pickupEnabled) ? (
        <T style={{ color: colors.warning }}>{!loc.isOpen ? 'The restaurant is closed right now.' : !loc.acceptingOrders ? 'The restaurant has paused new orders.' : 'Pickup is unavailable.'}</T>
      ) : null}
      {data.basket.lines.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T variant="heading" style={{ flex: 1 }}>{l.name}</T>
            {l.unitPriceCents != null ? <T>{formatMoney(l.unitPriceCents * l.quantity)}</T> : null}
          </View>
          {l.options.length ? <T variant="small" muted>{l.options.join(', ')}</T> : null}
          {l.notes ? <T variant="small" muted>“{l.notes}”</T> : null}
          {l.issue ? <T variant="small" style={{ color: colors.danger }}>{l.issue}</T> : null}
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <Button title="−" variant="secondary" onPress={() => setQty(l, l.quantity - 1)} accessibilityLabel={`Remove one ${l.name}`} />
            <T>{l.quantity}</T>
            <Button title="+" variant="secondary" onPress={() => setQty(l, l.quantity + 1)} accessibilityLabel={`Add one ${l.name}`} />
          </View>
        </Card>
      ))}
      {q ? (
        <Card>
          <Row label="Subtotal" value={formatMoney(q.subtotalCents)} />
          <Row label="Service fee" value={formatMoney(q.serviceFeeCents)} />
          <Row label="Total (AUD)" value={formatMoney(q.totalCents)} bold />
          <T variant="small" muted>Includes GST of {formatMoney(q.gstCents)}. Prices are set by the restaurant.</T>
        </Card>
      ) : null}
      <Field label="Name for pickup" value={pickupName} onChangeText={setPickupName} maxLength={40} />
      <Field label="Note to restaurant (optional)" value={note} onChangeText={setNote} maxLength={300} />
      <T variant="small" muted>The restaurant sees your pickup name and order only — never your email or phone number.</T>
      <Button title={q ? `Place pickup order · ${formatMoney(q.totalCents)}` : 'Place order'} onPress={checkout} loading={busy} disabled={!data.canCheckout || !pickupName.trim()} />
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T variant={bold ? 'heading' : 'body'}>{label}</T><T variant={bold ? 'heading' : 'body'}>{value}</T></View>;
}
