import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, T, ToggleRow } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { PRIVACY_POLICY_VERSION, useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

type ConsentKey = 'personalisation' | 'precise_location' | 'marketing_email' | 'marketing_push';
const CONSENTS: { key: ConsentKey; label: string; description: string }[] = [
  { key: 'personalisation', label: 'Personalised recommendations', description: 'Use my activity on CRAVE to rank my feed. When off, you see nearby and trending food only.' },
  { key: 'precise_location', label: 'Precise location', description: 'Use device location to find restaurants that can serve me. Not stored in your activity history.' },
  { key: 'marketing_email', label: 'Marketing emails', description: 'Offers and news from CRAVE.' },
  { key: 'marketing_push', label: 'Marketing notifications', description: 'Promotional push notifications. Order updates are always sent.' },
];

export default function PrivacyScreen() {
  const { session, signOut, demoMode } = useAuth();
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase || !userId) return;
    supabase.from('current_privacy_consents').select('consent_type, granted').eq('user_id', userId)
      .then(({ data }) => setConsents(Object.fromEntries((data ?? []).map((r) => [r.consent_type, r.granted]))));
  }, [userId]);

  async function setConsent(key: ConsentKey, granted: boolean) {
    if (!supabase || !userId) return;
    const previous = consents[key];
    setConsents((c) => ({ ...c, [key]: granted }));
    const { error } = await supabase.from('privacy_consents').insert({
      user_id: userId, consent_type: key, granted, policy_version: PRIVACY_POLICY_VERSION, source: 'app',
    });
    if (error) {
      setConsents((c) => ({ ...c, [key]: previous }));
      Alert.alert('Could not save', error.message);
    }
  }

  function resetTaste() {
    Alert.alert(
      'Reset My Taste Profile?',
      'This permanently deletes your swipes, viewing history, searches and learned food preferences. Past orders stay in your order history but will no longer influence recommendations.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset, keep Cravings', onPress: () => runReset(false) },
        { text: 'Reset everything', style: 'destructive', onPress: () => runReset(true) },
      ],
    );
  }

  async function runReset(clearAll: boolean) {
    if (!supabase) return;
    setBusy('reset');
    const { error } = await supabase.rpc('reset_taste_profile', { p_clear_cravings: clearAll, p_clear_explicit_preferences: clearAll });
    setBusy(null);
    Alert.alert(error ? 'Reset failed' : 'Taste profile reset', error ? error.message : 'Your feed will start fresh.');
  }

  function deleteAccount() {
    Alert.alert(
      'Delete your account?',
      'Your profile is hidden immediately and your personal data is deleted once any open orders are finished. Order and payment records are kept only as long as tax law requires, without your profile attached.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account', style: 'destructive', onPress: async () => {
            if (!supabase) return;
            setBusy('delete');
            const { error } = await supabase.rpc('request_account_deletion');
            setBusy(null);
            if (error) return Alert.alert('Request failed', error.message);
            await signOut();
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {demoMode ? <T style={{ color: colors.warning }}>Demo mode: settings are shown for reference and cannot be saved.</T> : null}

      <Card>
        <T variant="heading">What CRAVE uses to recommend food</T>
        <T muted>• Videos you watch, how long you watch, and skips{'\n'}• Swipes (Crave it / Not for me), likes and saves{'\n'}• Menu items you open, add to basket and order{'\n'}• Food preferences you set yourself{'\n'}• Your approximate area, to show restaurants that can serve you</T>
        <T variant="heading">What CRAVE never does</T>
        <T muted>• Guess allergies, health conditions or religion from your behaviour — dietary filters only come from choices you make{'\n'}• Share your email, phone or viewing history with restaurants or creators{'\n'}• Sell your personal information</T>
      </Card>

      <Card>
        {CONSENTS.map((c) => (
          <ToggleRow key={c.key} label={c.label} description={c.description} value={!!consents[c.key]}
            onValueChange={(v) => setConsent(c.key, v)} disabled={demoMode} />
        ))}
      </Card>

      <View style={{ gap: space.md }}>
        <Button title="Reset My Taste Profile" variant="secondary" onPress={resetTaste} loading={busy === 'reset'} disabled={demoMode} />
        <Button title="Delete my account" variant="danger" onPress={deleteAccount} loading={busy === 'delete'} disabled={demoMode} />
      </View>
      <T variant="small" muted>Privacy policy version {PRIVACY_POLICY_VERSION} (draft, pending legal review). Questions: privacy@crave.example</T>
    </ScrollView>
  );
}
