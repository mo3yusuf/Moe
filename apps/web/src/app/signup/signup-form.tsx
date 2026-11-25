'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { signUpBusiness } from './actions';

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpBusiness, undefined);
  if (state?.checkEmail) {
    return (
      <div className="stack">
        <h2 style={{ margin: 0 }}>Check your email</h2>
        <p className="muted" style={{ margin: 0 }}>We sent a link to <strong>{state.checkEmail}</strong>. Tap it to confirm your account — you’ll go straight to setting up your store.</p>
      </div>
    );
  }
  return (
    <form action={action} className="stack">
      <label>Your name<input name="name" autoComplete="name" defaultValue={state?.fields?.name} required maxLength={60} /></label>
      <label>Work email<input name="email" type="email" autoComplete="email" defaultValue={state?.fields?.email} required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /><span style={{ fontWeight: 400 }}>At least 10 characters.</span></label>
      <label style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, fontWeight: 500, color: 'var(--text)' }}>
        <input type="checkbox" name="authorised" required style={{ width: 20, minHeight: 20, marginTop: 2 }} />
        I own or manage this restaurant and I’m authorised to list it on CRAVE.
      </label>
      {state?.error ? <p className="error" role="alert" style={{ margin: 0 }}>{state.error}</p> : null}
      <button className="btn big" type="submit" disabled={pending}>{pending ? 'Creating your account…' : 'Create business account'}</button>
      <p className="muted" style={{ margin: 0, textAlign: 'center' }}>Already have a CRAVE account? <Link href="/login?next=/restaurant/onboarding">Sign in</Link></p>
    </form>
  );
}
