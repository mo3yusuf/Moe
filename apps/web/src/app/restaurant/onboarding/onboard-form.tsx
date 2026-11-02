'use client';
import { useActionState } from 'react';
import { createRestaurant } from './actions';

export function OnboardForm({ suburbs, cuisines }: { suburbs: string[]; cuisines: [string, string][] }) {
  const [state, action, pending] = useActionState(createRestaurant, undefined);
  const f = state?.fields ?? {};
  return (
    <form action={action} className="stack">
      <label>Restaurant name<input name="name" defaultValue={f.name} required maxLength={100} /></label>
      <div className="grid">
        <label>Legal entity name<input name="legalName" defaultValue={f.legalName} required /></label>
        <label>ABN<input name="abn" defaultValue={f.abn} required inputMode="numeric" placeholder="51 824 753 556" /></label>
      </div>
      <label>Short description<textarea name="description" defaultValue={f.description} maxLength={1000} rows={3} /></label>
      <fieldset className="card" style={{ padding: 12 }}>
        <legend className="muted">Cuisines</legend>
        <div className="row">{cuisines.map(([value, label]) => (
          <label key={value} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
            <input type="checkbox" name="cuisines" value={value} style={{ width: 18, minHeight: 18 }} /> {label}
          </label>
        ))}</div>
      </fieldset>
      <div className="grid">
        <label>Street address<input name="address" defaultValue={f.address} required placeholder="12 Example Street" /></label>
        <label>Suburb<select name="suburb" defaultValue={f.suburb ?? ''} required>
          <option value="" disabled>Choose…</option>
          {suburbs.map((s) => <option key={s}>{s}</option>)}
        </select></label>
        <label>Phone<input name="phone" defaultValue={f.phone} placeholder="07 3123 4567" /></label>
      </div>
      <div className="grid">
        <label>Price level<select name="priceLevel" defaultValue={f.priceLevel ?? '2'}>
          <option value="1">$ — under $15</option><option value="2">$$ — $15–25</option><option value="3">$$$ — $25–40</option><option value="4">$$$$ — $40+</option>
        </select></label>
        <label>Typical prep time (minutes)<input name="prepTime" type="number" min={5} max={120} defaultValue={f.prepTime ?? '15'} /></label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Location is placed at your suburb’s centre for now (good enough for “near me”). Exact geocoding is added before delivery launches.
      </p>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <div><button className="btn" disabled={pending}>{pending ? 'Creating…' : 'Create restaurant'}</button></div>
    </form>
  );
}
