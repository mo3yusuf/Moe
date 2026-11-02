'use client';
import { useActionState } from 'react';
import type { FormState } from '../actions';

export function OptionGroupForm({ action }: { action: (p: FormState | undefined, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="stack">
      <div className="grid">
        <label>Group name<input name="name" placeholder="Size, Sauce, Extras…" required /></label>
        <label>Min choices<input name="min" type="number" min={0} max={20} defaultValue={0} /></label>
        <label>Max choices<input name="max" type="number" min={1} max={20} defaultValue={1} /></label>
      </div>
      <label>Options — one per line, optional price change after “|”<textarea name="options" rows={4} placeholder={'Regular\nLarge | 3.00\nExtra cheese | 2.00'} /></label>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      {state?.ok ? <p style={{ color: 'var(--success)' }}>{state.ok}</p> : null}
      <div><button className="btn secondary" disabled={pending}>Add customisation</button></div>
    </form>
  );
}
