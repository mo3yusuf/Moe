'use client';
import { useActionState } from 'react';

export function TicketForm({ action }: { action: (p: { error?: string; ok?: string } | undefined, f: FormData) => Promise<{ error?: string; ok?: string }> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="stack">
      <div className="grid">
        <label>Subject<input name="subject" maxLength={140} required /></label>
        <label>Order number (optional)<input name="order" placeholder="CR-1234" /></label>
      </div>
      <label>How can we help?<textarea name="body" rows={4} maxLength={4000} required /></label>
      {state?.error ? <p className="error">{state.error}</p> : null}
      {state?.ok ? <p style={{ color: 'var(--success)' }}>{state.ok}</p> : null}
      <div><button className="btn" disabled={pending}>Send to CRAVE support</button></div>
    </form>
  );
}
