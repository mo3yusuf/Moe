import { View } from 'react-native';
import { Screen, T } from '@/components/ui';
import { space } from '@/theme/tokens';

export default function Discover() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
        <T variant="title" accessibilityRole="header">Discover</T>
        <T muted>Nearby restaurants and search arrive in Phase 4.</T>
      </View>
    </Screen>
  );
}
