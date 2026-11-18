'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { setNewPassword } from './actions';

export default function ResetPassword() {
  const [state, action, pending] = useActionState(setNewPassword, undefined);
  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div className="card stack" style={{ marginTop: 48 }}>
        <h1 style={{ margin: 0 }}>Choose a new password</h1>
        <form action={action} className="stack">
          <label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
          <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
          {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
          <button className="btn" disabled={pending}>{pending ? 'Saving…' : 'Save new password'}</button>
        </form>
        <Link href="/forgot-password" className="muted">Link expired? Send a new one</Link>
      </div>
    </main>
  );
}
