'use client';
import { useActionState } from 'react';
import type { FormState } from './actions';

export interface ItemDefaults {
  name?: string; description?: string | null; section?: string; price?: string; cuisine?: string | null; category?: string | null;
  tags?: string[]; dietary?: string[]; allergens?: string[]; spice?: number | null; gstFree?: boolean;
}

export function ItemForm({ action, defaults = {}, cuisines, dietary, allergens, submitLabel }: {
  action: (prev: FormState | undefined, form: FormData) => Promise<FormState>;
  defaults?: ItemDefaults; cuisines: [string, string][]; dietary: [string, string][]; allergens: [string, string][]; submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="stack">
      <div className="grid">
        <label>Name<input name="name" defaultValue={defaults.name} required maxLength={120} /></label>
        <label>Price (AUD, GST inclusive)<input name="price" defaultValue={defaults.price} required placeholder="16.90" inputMode="decimal" /></label>
        <label>Menu section<input name="section" defaultValue={defaults.section ?? 'Mains'} /></label>
      </div>
      <label>Description<textarea name="description" defaultValue={defaults.description ?? ''} rows={2} maxLength={600} /></label>
      <div className="grid">
        <label>Cuisine<select name="cuisine" defaultValue={defaults.cuisine ?? ''}><option value="">—</option>{cuisines.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Dish type<input name="category" defaultValue={defaults.category ?? ''} placeholder="burger, sushi, curry…" /></label>
        <label>Spice level<select name="spice" defaultValue={defaults.spice == null ? '' : String(defaults.spice)}>
          <option value="">Not specified</option>{['None', 'Mild', 'Medium', 'Hot', 'Very hot'].map((l, i) => <option key={l} value={i}>{l}</option>)}
        </select></label>
      </div>
      <label>Descriptive tags (comma separated)<input name="tags" defaultValue={(defaults.tags ?? []).join(', ')} placeholder="chicken, fried, spicy" /></label>
      <fieldset className="card" style={{ padding: 12 }}>
        <legend className="muted">Dietary labels — only tick what is true for this dish as prepared</legend>
        <div className="row">{dietary.map(([v, l]) => (
          <label key={v} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
            <input type="checkbox" name="dietary" value={v} defaultChecked={defaults.dietary?.includes(v)} style={{ width: 18, minHeight: 18 }} /> {l}
          </label>
        ))}</div>
      </fieldset>
      <fieldset className="card" style={{ padding: 12 }}>
        <legend className="muted">Allergens this dish contains (FSANZ declaration list) — customers who avoid these won’t see it</legend>
        <div className="row">{allergens.map(([v, l]) => (
          <label key={v} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
            <input type="checkbox" name="allergens" value={v} defaultChecked={defaults.allergens?.includes(v)} style={{ width: 18, minHeight: 18 }} /> {l}
          </label>
        ))}</div>
      </fieldset>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" name="gstFree" defaultChecked={defaults.gstFree} style={{ width: 18, minHeight: 18 }} /> This item is GST-free (check with your accountant)
      </label>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      {state?.ok ? <p style={{ color: 'var(--success)' }} role="status">{state.ok}</p> : null}
      <div><button className="btn" disabled={pending}>{pending ? 'Saving…' : submitLabel}</button></div>
    </form>
  );
}
