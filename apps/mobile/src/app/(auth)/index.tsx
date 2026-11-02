import { Link } from 'expo-router';
import { View } from 'react-native';
import { Button, Screen, T } from '@/components/ui';
import { config } from '@/lib/config';
import { colors, space } from '@/theme/tokens';

export default function Welcome() {
  return (
    <Screen style={{ justifyContent: 'space-between', paddingVertical: space.xxl }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
        <T variant="display" style={{ fontSize: 56, color: colors.accent }} accessibilityRole="header">CRAVE</T>
        <T variant="title">Watch it. Crave it. Order it.</T>
        <T muted>{config.orderingEnabled
          ? 'Short food videos from Brisbane restaurants and creators — order the exact meal you just watched for pickup.'
          : 'Short food videos from Brisbane. Swipe what you crave, follow the people who find the best food, and share your own finds.'}</T>
      </View>
      <View style={{ gap: space.md }}>
        <Link href="/sign-up" asChild><Button title="Create account" /></Link>
        <Link href="/sign-in" asChild><Button title="I already have an account" variant="secondary" /></Link>
      </View>
    </Screen>
  );
}
