'use client';
import { useActionState, useState } from 'react';
import type { FormState } from '../actions';

const EXAMPLES: Record<string, { name: string; min: number; max: number; options: string }> = {
  list: { name: 'Extras', min: 0, max: 5, options: 'Extra patty | 4.00 | up to 3\nBacon | 3.00\nFried egg | 2.00' },
  chips: { name: 'Spice level', min: 1, max: 1, options: 'Mild\nMedium\nHot\nExtra hot' },
  remove: { name: 'Remove ingredients', min: 0, max: 6, options: 'Onions\nPickles\nTomato\nLettuce\nSauce' },
};

export function OptionGroupForm({ action, parents }: {
  action: (p: FormState | undefined, f: FormData) => Promise<FormState>;
  /** Options of this dish that a nested group can hang off ("only show when … is picked"). */
  parents: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [style, setStyle] = useState<'list' | 'chips' | 'remove'>('list');
  const ex = EXAMPLES[style]!;
  return (
    <form action={formAction} className="stack" key={style}>
      <div className="grid">
        <label>How customers see it
          <select name="style" value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
            <option value="list">List (with photos &amp; quantities)</option>
            <option value="chips">Chips (quick picks, e.g. spice level)</option>
            <option value="remove">Remove ingredients (tap to cross out)</option>
          </select>
        </label>
        <label>Group name<input name="name" defaultValue={ex.name} required /></label>
        <label>Min choices<input name="min" type="number" min={0} max={20} defaultValue={ex.min} /></label>
        <label>Max choices<input name="max" type="number" min={1} max={20} defaultValue={ex.max} /></label>
      </div>
      {parents.length ? (
        <label>Only show this group when… (nested choice)
          <select name="parent" defaultValue="">
            <option value="">Always show</option>
            {parents.map((p) => <option key={p.id} value={p.id}>…“{p.label}” is picked</option>)}
          </select>
        </label>
      ) : null}
      <label>Options — one per line. Add extras after “|”: a price (2.00), a quantity limit (up to 3), or a photo link (https://…)
        <textarea name="options" rows={5} defaultValue={ex.options} />
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" name="linkDishes" style={{ width: 18, minHeight: 18 }} /> Meal deal: each option is a dish on my menu (it shows sold out when that dish is)
      </label>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      {state?.ok ? <p style={{ color: 'var(--success)' }}>{state.ok}</p> : null}
      <div><button className="btn secondary" disabled={pending}>{pending ? 'Adding…' : 'Add customisation'}</button></div>
    </form>
  );
}
