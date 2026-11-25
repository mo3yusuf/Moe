'use client';

import { formatMoney } from '@crave/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { setSoldOut } from './actions';

export interface MenuRow {
  id: string; name: string; section: string; price_cents: number; is_available: boolean; image_url: string | null;
  dietary: string[]; sold_out_until: string | null;
}

/** The menu at a glance (Uber Eats Manager style): photo, price, one-tap "Sold out today", search. */
export function MenuList({ restaurantId, items, canEdit }: { restaurantId: string; items: MenuRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlySoldOut, setOnlySoldOut] = useState(false);

  const shown = useMemo(() => items.filter((i) => (!onlySoldOut || !i.is_available)
    && (!q.trim() || `${i.name} ${i.section}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, q, onlySoldOut]);
  const sections = useMemo(() => {
    const m = new Map<string, MenuRow[]>();
    for (const i of shown) m.set(i.section, [...(m.get(i.section) ?? []), i]);
    return [...m.entries()];
  }, [shown]);
  const soldOut = items.filter((i) => !i.is_available).length;
  const noPhoto = items.filter((i) => !i.image_url).length;

  async function toggle(i: MenuRow, soldOutNow: boolean, untilTomorrow = true) {
    setBusy(i.id); setError(null);
    const r = await setSoldOut(restaurantId, i.id, soldOutNow, untilTomorrow);
    if (r.error) setError(r.error);
    router.refresh();
    setBusy(null);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{items.length} dish{items.length === 1 ? '' : 'es'}{soldOut ? ` · ${soldOut} sold out` : ''}{noPhoto ? ` · ${noPhoto} without a photo` : ''}</span>
        <div className="row" style={{ gap: 8 }}>
          <input type="search" placeholder="Search your menu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your menu" style={{ width: 220 }} />
          {soldOut ? <button className={`btn ${onlySoldOut ? '' : 'secondary'}`} onClick={() => setOnlySoldOut((v) => !v)} aria-pressed={onlySoldOut}>Sold out ({soldOut})</button> : null}
        </div>
      </div>
      {error ? <p className="error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
      {items.length === 0 ? <p className="muted">No dishes yet — add your first one below.</p> : null}
      {items.length > 0 && shown.length === 0 ? <p className="muted">No dishes match.</p> : null}
      {sections.map(([section, rows]) => (
        <section key={section} className="stack" style={{ gap: 8 }} aria-label={section}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{section} <span className="muted" style={{ fontWeight: 500 }}>· {rows.length}</span></h2>
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((i) => (
              <div key={i.id} className={`dish ${i.is_available ? '' : 'dish-out'}`}>
                {i.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={i.image_url} alt="" className="dish-photo" />
                  : <Link href={`/restaurant/${restaurantId}/menu/${i.id}`} className="dish-photo dish-nophoto" aria-label={`Add a photo of ${i.name}`}>{canEdit ? '+ Photo' : 'No photo'}</Link>}
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  {canEdit ? <Link href={`/restaurant/${restaurantId}/menu/${i.id}`} className="dish-name">{i.name}</Link> : <span className="dish-name">{i.name}</span>}
                  <span className="muted" style={{ fontSize: 14 }}>{formatMoney(i.price_cents)}{i.dietary.length ? ` · ${i.dietary.join(', ')}` : ''}</span>
                  {!i.is_available ? <span style={{ color: 'var(--warning)', fontSize: 13, fontWeight: 700 }}>
                    {i.sold_out_until ? 'Sold out — back tomorrow' : 'Sold out until you turn it back on'}</span> : null}
                </div>
                <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                  {i.is_available ? (
                    <>
                      <button className="btn secondary" disabled={busy === i.id} onClick={() => void toggle(i, true, true)}>Sold out today</button>
                      <button className="linkish" disabled={busy === i.id} onClick={() => void toggle(i, true, false)}>Hide until I turn it on</button>
                    </>
                  ) : <button className="btn" disabled={busy === i.id} onClick={() => void toggle(i, false)}>Back in stock</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
