import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Badge, Card, DemoBanner, ListRow, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth';
import { space } from '@/theme/tokens';

interface Me {
  profile: { displayName: string; username: string | null };
  roles: string[];
  restaurants: { restaurantId: string; name: string; role: string }[];
}

export default function Profile() {
  const router = useRouter();
  const { session, signOut, demoMode } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) return;
    api<Me>('/v1/me').then(setMe).catch((e) => setError(e.message));
  }, [demoMode, session?.user.id]);

  return (
    <Screen padded={false}>
      {demoMode ? <DemoBanner /> : null}
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <T variant="title" accessibilityRole="header">{demoMode ? 'Demo guest' : me?.profile.displayName || 'Your profile'}</T>
          <T muted>{demoMode ? 'Not signed in — no backend configured' : session?.user.email}</T>
          {me?.roles.includes('admin') ? <Badge tone="info" label="Admin" /> : null}
          {error ? <T variant="small" muted>Couldn’t load profile: {error}</T> : null}
        </View>

        <Card style={{ padding: 0 }}>
          {me?.roles.includes('admin') ? (
            <ListRow icon="shield-checkmark-outline" title="Review videos" subtitle="Admin: approve or reject new uploads" onPress={() => router.push('/review-videos')} />
          ) : null}
          <ListRow icon="flame-outline" title="Your Cravings" subtitle="Meals you swiped right on" onPress={() => router.push('/cravings')} />
          <ListRow icon="restaurant-outline" title="Food preferences" subtitle="Cuisines, dietary requirements, spice, budget" onPress={() => router.push('/preferences')} />
          <ListRow icon="sparkles-outline" title="Your taste profile" subtitle="What CRAVE has learned from your activity" onPress={() => router.push('/taste-profile')} />
          <ListRow icon="lock-closed-outline" title="Privacy & personalisation" subtitle="What we use, consent choices, Reset My Taste Profile" onPress={() => router.push('/privacy')} />
        </Card>

        {me?.restaurants.length ? (
          <Card>
            <T variant="heading">Your restaurants</T>
            {me.restaurants.map((r) => <T key={r.restaurantId} muted>{r.name} · {r.role}</T>)}
            <T variant="small" muted>Manage menus and orders in the CRAVE web dashboard.</T>
          </Card>
        ) : null}

        {!demoMode ? (
          <Card style={{ padding: 0 }}>
            <ListRow icon="log-out-outline" title="Sign out" onPress={signOut} destructive />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
