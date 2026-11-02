import { View } from 'react-native';
import { Screen, T } from '@/components/ui';
import { space } from '@/theme/tokens';

export default function Create() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
        <T variant="title" accessibilityRole="header">Create</T>
        <T muted>Creator uploads arrive in Phase 4.</T>
      </View>
    </Screen>
  );
}
