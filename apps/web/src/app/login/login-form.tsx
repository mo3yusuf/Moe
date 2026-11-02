'use client';
import { useActionState } from 'react';
import { signIn } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
