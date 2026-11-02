import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { ToggleRow } from '@/components/ui/Toggle';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/env';
import { colors, radius, space, type } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [personalise, setPersonalise] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canSubmit = email.includes('@') && password.length >= (mode === 'sign-up' ? 10 : 1) && (mode === 'sign-in' || (terms && age && name.trim().length > 1));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
        router.back();
      } else {
        const { needsConfirmation } = await signUp({ email, password, displayName: name, personalisation: personalise, age16Plus: age });
        if (needsConfirmation) setInfo('Check your email to confirm your account, then sign in.');
        else router.back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>CRAVE</Text>
        <Text style={styles.tagline}>Watch it. Crave it. Order it.</Text>
        {!isSupabaseConfigured ? <Notice tone="warning" title="Accounts are not configured" body="Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see README)." /> : null}

        <View style={styles.modeRow} accessibilityRole="tablist">
          {(['sign-in', 'sign-up'] as const).map((m) => (
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setError(null); }} style={[styles.mode, mode === m && styles.modeActive]}>
              <Text style={[styles.modeText, mode === m && { color: colors.text }]}>{m === 'sign-in' ? 'Sign in' : 'Create account'}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'sign-up' ? <Field label="Name" value={name} onChangeText={setName} autoComplete="name" /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" />
        <Field label={mode === 'sign-up' ? 'Password (10+ characters)' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} />

        {mode === 'sign-up' ? (
          <View style={{ marginTop: space.md }}>
            <Check checked={age} onToggle={() => setAge(!age)} label="I am 16 or older" />
            <Check checked={terms} onToggle={() => setTerms(!terms)} label="I agree to the Terms of Service and Privacy Policy (drafts — pending legal review)" />
            <ToggleRow
              label="Personalise my feed"
              description="CRAVE learns from your swipes, watch time, saves and orders to recommend meals. You can turn this off or reset it any time in Privacy settings."
              value={personalise}
              onChange={setPersonalise}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {info ? <Text style={styles.info} accessibilityRole="alert">{info}</Text> : null}
        <Button size="lg" label={mode === 'sign-in' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} disabled={!canSubmit || !isSupabaseConfigured} style={{ marginTop: space.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.textDim} style={styles.input} {...rest} />
    </View>
  );
}

function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onToggle} style={styles.check}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.accent : colors.textMuted} />
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 44, fontWeight: '900', color: colors.text, letterSpacing: 2, marginTop: space.lg },
  tagline: { ...type.body, color: colors.accent, fontWeight: '700', marginBottom: space.xl },
  modeRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, marginBottom: space.md },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  modeActive: { backgroundColor: colors.surfaceRaised },
  modeText: { ...type.bodyStrong, color: colors.textMuted },
  label: { ...type.caption, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, minHeight: 50, fontSize: 16 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkText: { ...type.body, color: colors.text, flex: 1 },
  error: { ...type.body, color: colors.danger, marginTop: space.md },
  info: { ...type.body, color: colors.success, marginTop: space.md },
});
