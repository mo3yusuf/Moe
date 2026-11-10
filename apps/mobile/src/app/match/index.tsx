import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { Button, Notice, Screen, T } from '@/components/ui';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { colors, palette, radius, space } from '@/theme/tokens';

const STEPS: { icon: 'people' | 'swap-horizontal' | 'flame'; title: string; body: string }[] = [
  { icon: 'people', title: 'Start a group', body: 'Share the link or code with your friends.' },
  { icon: 'swap-horizontal', title: 'Everyone swipes', body: 'Same food videos, on your own phones.' },
  { icon: 'flame', title: 'It’s a match', body: 'When you all crave the same dish, you’ll know where to eat.' },
];

/** Crave Match: start a group, or join one with a code. */
export default function MatchHome() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'start' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!supabase) return;
    setBusy('start'); setError(null);
    const { data, error: e } = await supabase.rpc('create_crave_room');
    setBusy(null);
    if (e || !data) return setError(e?.message ?? 'Couldn’t start a group');
    router.replace({ pathname: '/match/[code]', params: { code: (data as { code: string }).code } });
  }

  function join() {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return setError('Group codes are 6 letters and numbers.');
    router.replace({ pathname: '/match/[code]', params: { code: c } });
  }

  if (config.demoMode) {
    return <Screen edges={[]}><T muted style={{ marginTop: space.lg }}>Crave Match needs a CRAVE account — not available in demo mode.</T></Screen>;
  }

  return (
    <Screen edges={[]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.xl, paddingVertical: space.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="flame" size={38} color={colors.accent} />
            </View>
            <T variant="display" style={{ textAlign: 'center' }}>Crave Match</T>
            <T muted style={{ textAlign: 'center', maxWidth: 320 }}>Can’t decide where to eat? Swipe together and let the food decide.</T>
          </View>

          <View style={{ gap: space.md }}>
            {STEPS.map((s, i) => (
              <View key={s.title} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={s.icon} size={20} color={colors.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <T variant="heading">{i + 1}. {s.title}</T>
                  <T variant="small" muted>{s.body}</T>
                </View>
              </View>
            ))}
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Button title={busy === 'start' ? 'Starting…' : 'Start a group'} onPress={start} disabled={!!busy}
            icon={<Ionicons name="people" size={20} color={colors.text} />} />

          <View style={{ gap: space.sm }}>
            <T variant="label" muted style={{ textAlign: 'center' }}>OR JOIN WITH A CODE</T>
            <View style={{ gap: space.sm }}>
              <TextInput
                value={code}
                onChangeText={(t) => { setCode(t.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()); setError(null); }}
                placeholder="K7Q2PX"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                accessibilityLabel="Group code"
                onSubmitEditing={join}
                style={{
                  minHeight: 56, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text,
                  fontSize: 22, fontWeight: '800', letterSpacing: 6, textAlign: 'center', borderWidth: 1,
                  borderColor: code.length === 6 ? palette.info.default : colors.border,
                }}
              />
              <Button title="Join group" variant="secondary" onPress={join} disabled={code.length !== 6} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
