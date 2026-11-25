'use client';
import { useActionState, useState } from 'react';
import { AddressSearch, type ChosenAddress } from '@/components/address-search';
import { createRestaurant } from './actions';

export function OnboardForm({ suburbs, cuisines }: { suburbs: string[]; cuisines: [string, string][] }) {
  const [state, action, pending] = useActionState(createRestaurant, undefined);
  const f = state?.fields ?? {};
  const [address, setAddress] = useState(f.address ?? '');
  const [suburb, setSuburb] = useState(f.suburb ?? '');
  const [found, setFound] = useState<ChosenAddress | null>(null);
  const suburbOptions = suburb && !suburbs.includes(suburb) ? [suburb, ...suburbs] : suburbs;
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
      <AddressSearch onChoose={(a) => { setFound(a); setAddress(a.line1); setSuburb(a.suburb); }} />
      {found ? (
        <>
          <p style={{ margin: 0, color: 'var(--success)', fontSize: 14 }}>✓ {found.formatted} — exact location saved</p>
          <input type="hidden" name="lat" value={found.lat} /><input type="hidden" name="lng" value={found.lng} />
          <input type="hidden" name="postcode" value={found.postcode} /><input type="hidden" name="state" value={found.state} />
        </>
      ) : null}
      <div className="grid">
        <label>Street address<input name="address" value={address} onChange={(e) => { setAddress(e.target.value); setFound(null); }} required placeholder="12 Example Street" /></label>
        <label>Suburb<select name="suburb" value={suburb} onChange={(e) => { setSuburb(e.target.value); setFound(null); }} required>
          <option value="" disabled>Choose…</option>
          {suburbOptions.map((x) => <option key={x}>{x}</option>)}
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
        {found ? 'We’ll use the exact location of your address for distances and delivery.' : 'Pick your address from the search above for an exact location; otherwise we use the centre of your suburb.'}
      </p>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <div><button className="btn" disabled={pending}>{pending ? 'Creating…' : 'Create restaurant'}</button></div>
    </form>
  );
}
