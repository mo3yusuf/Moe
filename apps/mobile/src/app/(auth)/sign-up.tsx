import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Card, Field, Screen, T, ToggleRow } from '@/components/ui';
import { useAuth } from '@/providers/auth';
import { colors, space } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [personalisation, setPersonalisation] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [policyOk, setPolicyOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailError = email && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : undefined;
  const passwordError = password && password.length < 10 ? 'Use at least 10 characters' : undefined;
  const valid = displayName.trim() && EMAIL_RE.test(email.trim()) && password.length >= 10 && ageOk && policyOk;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUp({
        email, password, displayName, personalisationConsent: personalisation, marketingEmailConsent: marketing,
      });
      if (needsEmailConfirmation) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen style={{ justifyContent: 'center', gap: space.lg }}>
        <T variant="title">Check your email</T>
        <T muted>We sent a confirmation link to {email.trim()}. Open it on this device, then sign in.</T>
        <Link href="/sign-in" asChild><Button title="Go to sign in" /></Link>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }} keyboardShouldPersistTaps="handled">
          <T variant="title" accessibilityRole="header">Create your CRAVE account</T>
          <Field label="Name" value={displayName} onChangeText={setDisplayName} autoComplete="name" maxLength={60} />
          <Field label="Email" value={email} onChangeText={setEmail} error={emailError} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} error={passwordError} secureTextEntry autoComplete="new-password" textContentType="newPassword" />

          <Card>
            <T variant="heading">Your privacy choices</T>
            <ToggleRow
              label="Personalise my feed"
              description="Use my swipes, views, saves and orders on CRAVE to recommend food. You can turn this off or reset it any time."
              value={personalisation} onValueChange={setPersonalisation}
            />
            <ToggleRow label="Email me offers" description="Occasional deals from CRAVE. Off by default." value={marketing} onValueChange={setMarketing} />
          </Card>

          <ToggleRow label="I am 16 or older" value={ageOk} onValueChange={setAgeOk} />
          <ToggleRow label="I agree to the Terms and Privacy Policy" description="Draft documents — pending legal review before launch." value={policyOk} onValueChange={setPolicyOk} />

          {error ? <T style={{ color: colors.danger }} accessibilityLiveRegion="polite">{error}</T> : null}
          <Button title="Create account" onPress={submit} loading={busy} disabled={!valid} />
          <View style={{ alignItems: 'center' }}>
            <Link href="/sign-in"><T muted>Already have an account? <T style={{ color: colors.accent }}>Sign in</T></T></Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
