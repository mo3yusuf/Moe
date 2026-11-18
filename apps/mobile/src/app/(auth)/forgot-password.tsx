import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Field, Notice, Screen, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Emails a password-reset link. The answer is always the same, so it can't reveal who has an account. */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!supabase) return;
    setBusy(true); setError(null);
    const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : 'crave://reset-password';
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    setBusy(false);
    if (e && !/rate|security purposes/i.test(e.message)) setError(e.message); else setSent(true);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <T variant="title" accessibilityRole="header">Reset your password</T>
        {sent ? (
          <Notice tone="success">If there’s a CRAVE account for {email.trim()}, a reset link is on its way. Open it on this phone.</Notice>
        ) : (
          <>
            <T muted>We’ll email you a link to choose a new password.</T>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" onSubmitEditing={submit} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button title={busy ? 'Sending…' : 'Email me a reset link'} onPress={submit} disabled={busy || !EMAIL_RE.test(email.trim())} />
          </>
        )}
        <View style={{ alignItems: 'center' }}>
          <Link href="/sign-in"><T style={{ color: colors.accent }}>Back to sign in</T></Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
