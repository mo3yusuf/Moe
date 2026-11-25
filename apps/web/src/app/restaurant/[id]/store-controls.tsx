'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setAcceptingOrders, setBusyMode } from './orders/actions';

/** The two switches a busy kitchen needs: take orders / pause, and "busy — add N minutes". */
export function StoreControls({ restaurantId, location }: {
  restaurantId: string;
  location: { id: string; accepting: boolean; openNow: boolean; prepMinutes: number; busyExtra: number; busyUntil: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyActive = !!location.busyUntil && new Date(location.busyUntil) > new Date() && location.busyExtra > 0;

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true); setError(null);
    const r = await fn();
    if (r.error) setError(r.error);
    router.refresh();
    setBusy(false);
  }

  const status = !location.accepting ? { label: 'Paused', cls: 'pill-off', note: 'Customers can see your menu but can’t order.' }
    : !location.openNow ? { label: 'Closed now', cls: '', note: 'Outside your opening hours. Orders open automatically at your next opening time.' }
    : { label: 'Open for orders', cls: 'pill-on', note: busyActive ? `Busy mode: ready times are ${location.busyExtra} min longer until ${new Date(location.busyUntil!).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' })}.` : `Orders are ready in about ${location.prepMinutes} min.` };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className={`pill ${status.cls}`} style={{ alignSelf: 'flex-start', cursor: 'default' }}>{status.label}</span>
          <span className="muted">{status.note}</span>
        </div>
        <button className={`btn ${location.accepting ? 'danger' : 'big'}`} disabled={busy}
          onClick={() => void run(() => setAcceptingOrders(restaurantId, location.id, !location.accepting))}>
          {location.accepting ? 'Pause new orders' : 'Resume taking orders'}
        </button>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <strong>Kitchen busy?</strong>
        <span className="muted" style={{ fontSize: 14 }}>Add time to every order for the next hour, so customers get an honest ready time.</span>
        <div className="seg" role="group" aria-label="Busy mode">
          {[0, 10, 20, 30].map((m) => {
            const active = m === 0 ? !busyActive : busyActive && location.busyExtra === m;
            return (
              <button key={m} className={active ? 'on' : ''} aria-pressed={active} disabled={busy}
                onClick={() => void run(() => setBusyMode(restaurantId, location.id, m, 60))}>
                {m === 0 ? 'Normal' : `+${m} min`}
              </button>
            );
          })}
        </div>
      </div>
      {error ? <p className="error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
