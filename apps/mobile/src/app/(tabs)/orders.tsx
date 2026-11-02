import { View } from 'react-native';
import { Screen, T } from '@/components/ui';
import { space } from '@/theme/tokens';

export default function Orders() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
        <T variant="title" accessibilityRole="header">Orders</T>
        <T muted>Pickup ordering arrives in Phase 5.</T>
      </View>
    </Screen>
  );
}
