import { formatMoney, ORDER_STATUS_LABELS, isTerminal, type OrderStatus } from '@crave/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, LoadingScreen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/theme/tokens';

interface Order {
  id: string; orderNumber: string; status: OrderStatus; restaurantName: string; pickupName: string; pickupAddress: string | null;
  estimatedReadyAt: string | null; subtotalCents: number; serviceFeeCents: number; totalCents: number; gstCents: number; cancelReason: string | null;
  items: { name: string; quantity: number; lineTotalCents: number; options: { name: string }[]; notes: string | null }[];
  events: { status: OrderStatus; at: string; note: string | null }[];
  refunds: { amountCents: number; status: string }[];
  payment: { provider: string; isTestMode: boolean } | null;
  fulfilment: 'pickup' | 'delivery'; deliveryFeeCents: number;
  delivery: { status: string; trackingUrl: string | null; courierName: string | null; estimatedDropoffAt: string | null; suburb: string } | null;
}
const STEPS: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'completed'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

/** Live pickup order status. Shows only real restaurant updates — no simulated tracking. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const load = useCallback(() => api<Order>(`/v1/orders/${id}`).then(setOrder).catch(() => {}), [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function cancel() {
    Alert.alert('Cancel this order?', 'You’ll get a full refund to your original payment method.', [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: async () => {
        const { error } = await supabase!.rpc('customer_cancel_order', { p_order_id: id, p_reason: 'Cancelled by customer' });
        if (error) Alert.alert('Couldn’t cancel', error.message);
        void load();
      } },
    ]);
  }

  if (!order) return <LoadingScreen />;
  const reached = new Map(order.events.map((e) => [e.status, e]));
  const stopped = order.status === 'rejected' || order.status === 'cancelled';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: order.orderNumber }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {order.payment?.isTestMode ? <T variant="label" style={{ color: colors.warning }}>TEST ORDER — NO REAL PAYMENT WAS TAKEN</T> : null}
        {order.status === 'pending_payment' ? <T muted>Confirming your payment with the bank…</T> : null}
        <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
          <T variant="title">{ORDER_STATUS_LABELS[order.status]}</T>
          <T muted>{order.restaurantName}{order.pickupAddress ? ` · ${order.pickupAddress}` : ''}</T>
          {order.estimatedReadyAt && !isTerminal(order.status) ? <T>Estimated ready around {time(order.estimatedReadyAt)}</T> : null}
          {order.status === 'ready' && order.fulfilment === 'pickup' ? <T style={{ color: colors.success }}>Head to the counter and give the name “{order.pickupName}”.</T> : null}
          {order.delivery ? (
            <Card>
              <T variant="heading">Delivery to {order.delivery.suburb}</T>
              <T muted>{({ quoted: 'Waiting for the restaurant to accept', requested: 'Finding a courier', courier_assigned: `Courier assigned${order.delivery.courierName ? `: ${order.delivery.courierName}` : ''}`,
                picked_up: 'On its way', delivered: 'Delivered', cancelled: 'Delivery cancelled', failed: 'Delivery problem — support has been alerted' } as Record<string, string>)[order.delivery.status] ?? order.delivery.status}</T>
              {order.delivery.estimatedDropoffAt ? <T muted>Estimated arrival {time(order.delivery.estimatedDropoffAt)}</T> : null}
              {order.delivery.trackingUrl ? <Button title="Track with the delivery partner" variant="secondary" onPress={() => Linking.openURL(order.delivery!.trackingUrl!)} /> : null}
            </Card>
          ) : null}
          {stopped && order.cancelReason ? <T muted>Reason: {order.cancelReason}</T> : null}
        </View>
        {!stopped ? (
          <Card>
            {STEPS.map((s) => {
              const e = reached.get(s) ?? (s === 'placed' && order.status !== 'pending_payment' ? { at: '', note: null } : undefined);
              return (
                <View key={s} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T style={{ color: e ? colors.text : colors.textFaint }}>{e ? '● ' : '○ '}{ORDER_STATUS_LABELS[s]}</T>
                  {e?.at ? <T muted>{time(e.at)}</T> : null}
                </View>
              );
            })}
          </Card>
        ) : null}
        <Card>
          {order.items.map((i, idx) => (
            <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <T style={{ flex: 1 }}>{i.quantity} × {i.name}{i.options.length ? ` (${i.options.map((o) => o.name).join(', ')})` : ''}</T>
              <T>{formatMoney(i.lineTotalCents)}</T>
            </View>
          ))}
          <T muted>Service fee {formatMoney(order.serviceFeeCents)}</T>
          {order.deliveryFeeCents ? <T muted>Delivery fee {formatMoney(order.deliveryFeeCents)}</T> : null}
          <T variant="heading">Total {formatMoney(order.totalCents)} <T variant="small" muted>incl. GST {formatMoney(order.gstCents)}</T></T>
        </Card>
        {order.refunds.map((r, i) => <T key={i} muted>Refund of {formatMoney(r.amountCents)}: {r.status}</T>)}
        {order.status === 'placed' || order.status === 'pending_payment' ? <Button title="Cancel order" variant="danger" onPress={cancel} /> : null}
      </ScrollView>
    </>
  );
}
