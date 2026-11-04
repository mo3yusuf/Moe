import { titleCase } from '@crave/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, LoadingScreen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { colors, space } from '@/theme/tokens';

interface Taste {
  personalised: boolean; resetAt: string | null; signalsUsed: number;
  likes: { type: string; value: string; strength: number }[]; dislikes: { type: string; value: string; strength: number }[];
}
const TYPE: Record<string, string> = { cuisine: 'Cuisine', category: 'Dish', tag: 'Ingredient / style', price: 'Price level', cert: 'Certification' };

function Bar({ label, strength }: { label: string; strength: number }) {
  return (
    <View style={{ gap: 4 }}>
      <T variant="small">{label}</T>
      <View style={{ height: 6, backgroundColor: colors.surfaceRaised, borderRadius: 3 }}>
        <View style={{ width: `${Math.round(Math.abs(strength) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: strength > 0 ? colors.accent : colors.textFaint }} />
      </View>
    </View>
  );
}

/** Transparency: shows exactly what the recommendation engine has learned. */
export default function TasteProfileScreen() {
  const router = useRouter();
  const [taste, setTaste] = useState<Taste | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (config.demoMode) { setError('Your taste profile is built from your account activity — not available in demo mode.'); return; }
    api<Taste>('/v1/taste-profile').then(setTaste).catch((e) => setError(e.message));
  }, []);

  if (!taste && !error) return <LoadingScreen />;
  const fmt = (x: { type: string; value: string }) => `${titleCase(x.value)} · ${TYPE[x.type] ?? x.type}`;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {error ? <T muted>{error}</T> : null}
      {taste && !taste.personalised ? (
        <Card><T variant="heading">Personalisation is off</T><T muted>Your feed shows nearby and popular food, filtered by the preferences you set. Turn it on in Privacy & personalisation.</T></Card>
      ) : null}
      {taste?.personalised ? (
        <>
          <T muted>Based on {taste.signalsUsed} recent action{taste.signalsUsed === 1 ? '' : 's'}: swipes, saves, likes, longer views and orders. Older activity counts less over time.</T>
          <Card>
            <T variant="heading">You seem to crave</T>
            {taste.likes.length ? taste.likes.map((l) => <Bar key={l.type + l.value} label={fmt(l)} strength={l.strength} />) : <T muted>Nothing yet — swipe right on meals you’d eat.</T>}
          </Card>
          <Card>
            <T variant="heading">Showing you less of</T>
            {taste.dislikes.length ? taste.dislikes.map((l) => <Bar key={l.type + l.value} label={fmt(l)} strength={l.strength} />) : <T muted>Nothing yet.</T>}
            <T variant="small" muted>We never fully hide a type of food because of a few swipes — you’ll still see the odd one so your tastes can change.</T>
          </Card>
        </>
      ) : null}
      <Button title="Edit food preferences" variant="secondary" onPress={() => router.push('/preferences')} />
      <Button title="Reset My Taste Profile" variant="ghost" onPress={() => router.push('/privacy')} />
    </ScrollView>
  );
}
