import { formatMoney } from '@crave/core';
import { useStripe } from '@/lib/stripe';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Field, T } from '@/components/ui';
import { AddressForm, type AddressValue } from '@/features/delivery/address-form';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

interface Line { id: string; name: string; quantity: number; options: string[]; notes: string | null; unitPriceCents: number | null; issue: string | null }
interface BasketResponse {
  basket: { restaurantName: string; lines: Line[] } | null;
  quote?: { subtotalCents: number; serviceFeeCents: number; totalCents: number; gstCents: number; currency: string } | null;
  location?: { isOpen: boolean; acceptingOrders: boolean; pickupEnabled: boolean; prepTimeMinutes: number } | null;
  canCheckout?: boolean;
  delivery?: { available: boolean; radiusKm: number | null; minOrderCents: number | null };
}

export default function BasketScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<BasketResponse | null>(null);
  const [pickupName, setPickupName] = useState(String(session?.user.user_metadata?.display_name ?? '').split(' ')[0] ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState<AddressValue | null>(null);
  const [dq, setDq] = useState<{ deliveryFeeCents: number; etaMinutes: number; quote: { totalCents: number; gstCents: number } } | null>(null);

  async function getDeliveryQuote() {
    if (!address) return;
    try { setDq(await api('/v1/delivery/quote', { body: { address } })); }
    catch (e) { setDq(null); Alert.alert('Delivery unavailable', e instanceof Error ? e.message : 'Please try pickup'); }
  }
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
      const res = await api<{ order: { id: string; totalCents: number }; payment: { mode: string; clientSecret?: string; testMode?: boolean } }>('/v1/checkout', {
        body: { pickupName, note: note || null, idempotencyKey: idempotencyKey.current, fulfilment, ...(fulfilment === 'delivery' ? { deliveryAddress: address } : {}) },
      });
      idempotencyKey.current = Crypto.randomUUID();
      if (res.payment.mode === 'simulated') router.replace({ pathname: '/pay/[id]', params: { id: res.order.id, total: String(res.order.totalCents) } });
      else if (res.payment.mode === 'stripe' && res.payment.clientSecret) {
        if (!config.stripePublishableKey) throw new Error('Card payments are not configured in this build.');
        // Stripe PaymentSheet: card details go directly to Stripe and never touch CRAVE's servers.
        const init = await initPaymentSheet({
          paymentIntentClientSecret: res.payment.clientSecret,
          merchantDisplayName: 'CRAVE',
          returnURL: 'crave://stripe-redirect',
          applePay: { merchantCountryCode: 'AU' },
          googlePay: { merchantCountryCode: 'AU', testEnv: !!res.payment.testMode },
          defaultBillingDetails: { address: { country: 'AU' } },
        });
        if (init.error) throw new Error(init.error.message);
        const paid = await presentPaymentSheet();
        if (paid.error) {
          // Cancelled or declined: the order stays unpaid (it expires after 30 minutes) and nothing is sent to the restaurant.
          if (paid.error.code !== 'Canceled') Alert.alert('Payment didn’t go through', paid.error.message);
          return;
        }
        // The order is released to the restaurant only when Stripe's webhook confirms payment.
        router.replace(`/order/${res.order.id}`);
      }
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
      {data.delivery?.available ? (
        <Card>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Pickup" variant={fulfilment === 'pickup' ? 'primary' : 'secondary'} onPress={() => { setFulfilment('pickup'); setDq(null); }} style={{ flex: 1 }} />
            <Button title="Delivery" variant={fulfilment === 'delivery' ? 'primary' : 'secondary'} onPress={() => setFulfilment('delivery')} style={{ flex: 1 }} />
          </View>
          {fulfilment === 'delivery' ? (
            <>
              <AddressForm onChange={(a) => { setAddress(a); setDq(null); }} />
              <Button title="Check delivery fee" variant="secondary" onPress={getDeliveryQuote} disabled={!address} />
              {dq ? <T>Delivery {formatMoney(dq.deliveryFeeCents)} · about {dq.etaMinutes} min after pickup · total {formatMoney(dq.quote.totalCents)}</T> : null}
            </>
          ) : null}
        </Card>
      ) : null}
      {q ? (
        <Card>
          <Row label="Subtotal" value={formatMoney(q.subtotalCents)} />
          <Row label="Service fee" value={formatMoney(q.serviceFeeCents)} />
          {fulfilment === 'delivery' && dq ? <Row label="Delivery fee" value={formatMoney(dq.deliveryFeeCents)} /> : null}
          <Row label="Total (AUD)" value={formatMoney(fulfilment === 'delivery' && dq ? dq.quote.totalCents : q.totalCents)} bold />
          <T variant="small" muted>Includes GST of {formatMoney(fulfilment === 'delivery' && dq ? dq.quote.gstCents : q.gstCents)}. Prices are set by the restaurant.</T>
        </Card>
      ) : null}
      <Field label={fulfilment === 'delivery' ? 'Name for the courier' : 'Name for pickup'} value={pickupName} onChangeText={setPickupName} maxLength={40} />
      <Field label="Note to restaurant (optional)" value={note} onChangeText={setNote} maxLength={300} />
      <T variant="small" muted>The restaurant sees your pickup name and order only — never your email or phone number.</T>
      <Button
        title={fulfilment === 'delivery' ? (dq ? `Place delivery order · ${formatMoney(dq.quote.totalCents)}` : 'Check the delivery fee first') : q ? `Place pickup order · ${formatMoney(q.totalCents)}` : 'Place order'}
        onPress={checkout} loading={busy}
        disabled={!data.canCheckout || !pickupName.trim() || (fulfilment === 'delivery' && !dq)} />
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T variant={bold ? 'heading' : 'body'}>{label}</T><T variant={bold ? 'heading' : 'body'}>{value}</T></View>;
}
