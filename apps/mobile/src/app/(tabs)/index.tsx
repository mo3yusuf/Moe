import { View } from 'react-native';
import { Screen, T } from '@/components/ui';
import { space } from '@/theme/tokens';

export default function ForYou() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
        <T variant="title" accessibilityRole="header">For You</T>
        <T muted>The video feed arrives in Phase 2.</T>
      </View>
    </Screen>
  );
}
