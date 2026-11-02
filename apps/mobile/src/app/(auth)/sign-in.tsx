import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Field, Screen, T } from '@/components/ui';
import { useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <T variant="title" accessibilityRole="header">Welcome back</T>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
        {error ? <T style={{ color: colors.danger }} accessibilityLiveRegion="polite">{error}</T> : null}
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
        <View style={{ alignItems: 'center' }}>
          <Link href="/sign-up"><T muted>New to CRAVE? <T style={{ color: colors.accent }}>Create an account</T></T></Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
