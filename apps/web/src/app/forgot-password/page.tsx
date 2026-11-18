'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { requestReset } from './actions';

export default function ForgotPassword() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div className="card stack" style={{ marginTop: 48 }}>
        <h1 style={{ margin: 0 }}>Reset your password</h1>
        {state?.done ? (
          <p role="status">If there’s a CRAVE account for that email, a reset link is on its way. Check your inbox (and spam).</p>
        ) : (
          <form action={action} className="stack">
            <p className="muted" style={{ margin: 0 }}>We’ll email you a link to choose a new password.</p>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
            <button className="btn" disabled={pending}>{pending ? 'Sending…' : 'Email me a reset link'}</button>
          </form>
        )}
        <Link href="/login" className="muted">← Back to sign in</Link>
      </div>
    </main>
  );
}
