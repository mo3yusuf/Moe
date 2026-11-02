import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';

export default function OrdersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  return (
    <Screen title="Orders" subtitle="Pickup orders and their live status.">
      <Notice tone="warning" title="Ordering arrives in Phase 5" body="The basket, pickup checkout, Stripe test payments, order confirmation and status tracking are next. Nothing can be ordered or paid for yet." />
      {!session ? <Button label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
    </Screen>
  );
}
