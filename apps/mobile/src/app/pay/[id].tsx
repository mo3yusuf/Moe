import { formatMoney } from '@crave/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, T } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, space } from '@/theme/tokens';

/**
 * DEVELOPMENT ONLY — simulated payment step. The API refuses this in production; Stripe replaces it in Phase 7.
 * Clearly labelled so nobody mistakes it for a real charge.
 */
export default function SimulatedPayment() {
  const { id, total } = useLocalSearchParams<{ id: string; total: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      await api(`/v1/orders/${id}/pay-simulated`, { method: 'POST' });
      router.replace(`/order/${id}`);
    } catch (e) {
      Alert.alert('Payment failed', e instanceof Error ? e.message : 'Please try again');
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg, justifyContent: 'center' }}>
      <Card style={{ borderWidth: 2, borderColor: colors.warning }}>
        <T variant="title" style={{ color: colors.warning }}>TEST PAYMENT</T>
        <T>No real money will be taken. Card payments (Stripe) are added in a later build.</T>
      </Card>
      <T variant="display" style={{ textAlign: 'center' }}>{formatMoney(Number(total) || 0)}</T>
      <Button title="Confirm test payment" onPress={pay} loading={busy} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </View>
  );
}
