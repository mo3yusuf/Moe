import { formatMoney, ORDER_STATUS_LABELS, type OrderStatus } from '@crave/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Button, Card, DemoBanner, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, space } from '@/theme/tokens';

interface O { id: string; orderNumber: string; status: OrderStatus; restaurantName: string; totalCents: number; createdAt: string; items: { quantity: number }[] }

export default function Orders() {
  const router = useRouter();
  const [orders, setOrders] = useState<O[] | null>(null);
  const [basketCount, setBasketCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (config.demoMode) return;
    api<{ items: O[] }>('/v1/orders').then((r) => setOrders(r.items)).catch(() => setOrders([]));
    api<{ basket: { lines: { quantity: number }[] } | null }>('/v1/basket').then((b) => setBasketCount(b.basket?.lines.reduce((a, l) => a + l.quantity, 0) ?? 0)).catch(() => {});
  }, []));

  if (config.demoMode) return <Screen padded={false}><DemoBanner /><View style={{ padding: space.lg, gap: space.sm }}><T variant="title">Orders</T><T muted>Ordering is disabled in demo mode.</T></View></Screen>;

  return (
    <Screen>
      <FlatList
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <T variant="title" accessibilityRole="header">Orders</T>
            {basketCount ? <Button title={`View basket (${basketCount})`} onPress={() => router.push('/basket')} /> : null}
          </View>
        }
        ListEmptyComponent={orders ? <T muted>No orders yet. Tap “Order now” on a video to get started.</T> : undefined}
        renderItem={({ item: o }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/order/${o.id}`)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T variant="heading">{o.restaurantName}</T>
                <T>{formatMoney(o.totalCents)}</T>
              </View>
              <T style={{ color: ['ready'].includes(o.status) ? colors.success : ['rejected', 'cancelled'].includes(o.status) ? colors.danger : colors.textMuted }}>{ORDER_STATUS_LABELS[o.status]}</T>
              <T variant="small" muted>{o.orderNumber} · {new Date(o.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} · {o.items.reduce((a, i) => a + i.quantity, 0)} items</T>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
