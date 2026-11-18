import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Field, MissingHint, Notice, Screen, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

/** Opened from the password-reset email (the link signs the person in for this one purpose). */
export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const missing = [
    password.length < 10 && 'Use at least 10 characters',
    password !== confirm && 'Type the same password twice',
  ].filter((m): m is string => !!m);

  async function save() {
    if (!supabase) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e) setError(e.message); else setDone(true);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <T variant="title" accessibilityRole="header">Choose a new password</T>
        {done ? (
          <>
            <Notice tone="success">Your password has been updated.</Notice>
            <Button title="Continue to CRAVE" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
            <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
            <MissingHint items={missing} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button title={busy ? 'Saving…' : 'Save new password'} onPress={save} disabled={busy || missing.length > 0} />
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
