import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Screen, Section } from '@/components/ui/Screen';
import { ToggleRow } from '@/components/ui/Toggle';
import { api, type TasteProfileResponse } from '@/lib/api';
import { POLICY_VERSION, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/theme';

export default function PrivacyScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const taste = useQuery({ queryKey: ['taste', session?.user.id], enabled: !!session, queryFn: () => api<TasteProfileResponse>('/v1/me/taste-profile') });

  async function setPersonalisation(on: boolean) {
    if (!supabase || !session) return;
    const { error } = await supabase.from('profiles').update({ personalisation_enabled: on }).eq('id', session.user.id);
    if (!error) {
      await supabase.from('privacy_consents').insert({ user_id: session.user.id, consent: 'personalisation', granted: on, policy_version: POLICY_VERSION, source: 'app' });
      await refreshProfile();
    } else Alert.alert('Could not update', error.message);
  }

  async function setVisibility(isPublic: boolean) {
    if (!supabase || !session) return;
    await supabase.from('profiles').update({ visibility: isPublic ? 'public' : 'private' }).eq('id', session.user.id);
    await refreshProfile();
  }

  function confirmReset() {
    Alert.alert('Reset My Taste Profile?', 'This deletes what CRAVE has learned from your swipes, views and orders. Your Cravings, orders and food preferences are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api('/v1/me/taste-profile/reset', { method: 'POST', body: {} });
            await qc.invalidateQueries({ queryKey: ['taste'] });
            Alert.alert('Done', 'Your feed will start fresh.');
          } catch (e) {
            Alert.alert('Reset failed', e instanceof Error ? e.message : 'Try again');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const s = taste.data?.summary;
  return (
    <Screen>
      <Section title="How CRAVE personalises your feed">
        {(taste.data?.dataUsed ?? [
          'Videos you swipe right (CRAVE IT) or left (NOT FOR ME)',
          'How long you watch videos',
          'Likes, saves, shares and comments',
          'Menu items you open and add to your basket',
          'Orders you complete',
          'Food preferences you set yourself',
        ]).map((d) => <Text key={d} style={styles.bullet}>• {d}</Text>)}
        <Text style={[styles.bullet, { marginTop: space.md, color: colors.text }]}>Never used:</Text>
        {(taste.data?.notUsed ?? ['Your precise location', 'Health, allergy or religious information unless you set it as a preference']).map((d) => <Text key={d} style={styles.bullet}>• {d}</Text>)}
        <Text style={styles.small}>Restaurants and creators only see aggregated performance, never your individual viewing history.</Text>
      </Section>

      {!session ? <Notice title="Sign in to manage personalisation" body="Signed-out browsing isn’t personalised and nothing is recorded." /> : (
        <>
          <Section title="Controls">
            <ToggleRow label="Personalised recommendations" description="When off, nothing you watch or swipe is recorded for recommendations." value={profile?.personalisation_enabled ?? false} onChange={setPersonalisation} />
            <ToggleRow label="Public profile" description="Others can see your profile and videos." value={profile?.visibility !== 'private'} onChange={setVisibility} />
          </Section>

          <Section title="What CRAVE has learned">
            {s ? (
              <View>
                <Text style={styles.bullet}>Signals learned: {s.signalCount}</Text>
                <Text style={styles.bullet}>Cuisines you crave: {s.likedCuisines.map((c) => c.key).join(', ') || '—'}</Text>
                <Text style={styles.bullet}>Showing less of: {s.lessInterestedCuisines.map((c) => c.key).join(', ') || '—'}</Text>
                <Text style={styles.bullet}>Hidden videos: {s.hiddenVideoCount}</Text>
              </View>
            ) : <Text style={styles.bullet}>{taste.isLoading ? 'Loading…' : 'Unavailable'}</Text>}
            <Button variant="secondary" label="Reset My Taste Profile" onPress={confirmReset} loading={busy} style={{ marginTop: space.lg }} />
          </Section>

          <Section title="Your account">
            <Notice tone="warning" title="Self-service account deletion arrives in Phase 7" body="The database already supports anonymising and deleting accounts (orders are kept without your identity for tax record-keeping). Until the in-app flow ships, deletion requests must be handled manually by CRAVE support." />
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bullet: { ...type.body, color: colors.textMuted, marginBottom: 4 },
  small: { ...type.caption, color: colors.textDim, marginTop: space.md },
});
