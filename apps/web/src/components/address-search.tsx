'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface ChosenAddress { line1: string; suburb: string; postcode: string; state: string; lat: number; lng: number; formatted: string }

/**
 * Type-ahead address search (like Uber Eats sign-up): suggestions appear as you type; picking one
 * fills in the address. Hidden entirely when address search isn't set up (no Google key).
 */
export function AddressSearch({ onChoose }: { onChoose(a: ChosenAddress): void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: string; main: string; secondary: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const session = useRef(newSession());
  const skipNext = useRef(false); // picking a suggestion fills the box; don't search for that text
  const listId = useId();

  // Is address search available? (One quick check; the box stays hidden if not.)
  useEffect(() => {
    fetch('/api/places/suggest?q=').then((r) => r.json()).then((b: { enabled?: boolean }) => setEnabled(b.enabled === true)).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    if (!enabled || q.trim().length < 3) { setItems([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/places/suggest?q=${encodeURIComponent(q.trim())}&s=${session.current}`, { signal: ctrl.signal });
        const b = (await r.json()) as { suggestions?: typeof items; error?: string };
        setItems(b.suggestions ?? []); setNote(b.error ?? null); setOpen(true); setActive(-1);
      } catch { /* typing again cancels the previous search */ }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, enabled]);

  async function choose(i: number) {
    const s = items[i];
    if (!s) return;
    skipNext.current = true;
    setOpen(false); setItems([]); setQ(s.secondary ? `${s.main}, ${s.secondary}` : s.main);
    try {
      const r = await fetch(`/api/places/details?id=${encodeURIComponent(s.id)}&s=${session.current}`);
      const b = (await r.json()) as { address?: ChosenAddress; error?: string };
      if (b.address) { onChoose(b.address); setNote(null); } else setNote(b.error ?? 'Couldn’t load that address.');
    } catch { setNote('Couldn’t load that address — type it below instead.'); }
    session.current = newSession(); // a new search starts a new billing session
  }

  if (!enabled) return null;
  return (
    <div className="addr" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label>Find your restaurant or address
        <input type="search" value={q} placeholder="Start typing, e.g. 12 James St or your restaurant’s name" autoComplete="off"
          role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => setQ(e.target.value)} onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void choose(active); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
      </label>
      {open && items.length > 0 ? (
        <ul id={listId} role="listbox" className="addr-list">
          {items.map((s, i) => (
            <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} tabIndex={-1}
              className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(i)}>
              <strong>{s.main}</strong>{s.secondary ? <span className="muted"> {s.secondary}</span> : null}
            </li>
          ))}
          <li className="addr-credit" aria-hidden>Powered by Google</li>
        </ul>
      ) : null}
      {note ? <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{note}</p> : null}
    </div>
  );
}

function newSession() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
}
