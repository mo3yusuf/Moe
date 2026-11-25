'use client';

import { formatMoney } from '@crave/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { acceptOrder, setAcceptingOrders, setOrderStatus } from './actions';
import { ORDER_COLUMNS, type BoardOrder } from './shared';

/**
 * The restaurant's order screen, built for a tablet or phone at the counter (Uber Eats Manager style):
 * new orders ring until someone deals with them, three columns (New → Preparing → Ready), big buttons,
 * and live updates (Supabase Realtime, with a polling fallback).
 */

const PREP_CHOICES = [10, 15, 20, 30, 45];
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready'];
const DONE_LABEL: Record<string, string> = { completed: 'Collected', rejected: 'Declined', cancelled: 'Cancelled' };
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' }) : '');
const minsSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0);
const minsUntil = (iso: string | null, now: number) => (iso ? Math.round((new Date(iso).getTime() - now) / 60000) : null);
const delivery = (o: BoardOrder) => (Array.isArray(o.deliveries) ? o.deliveries[0] : o.deliveries) ?? null;

export function OrdersBoard({ restaurantId, location, initialOrders }: {
  restaurantId: string;
  location: { id: string; prepMinutes: number; accepting: boolean } | null;
  initialOrders: BoardOrder[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [accepting, setAccepting] = useState(location?.accepting ?? true);
  const [started, setStarted] = useState(false);
  const [silencedIds, setSilencedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);

  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const refresh = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().from('orders').select(ORDER_COLUMNS)
      .eq('restaurant_id', restaurantId).neq('status', 'pending_payment').gte('created_at', since)
      .order('created_at', { ascending: false });
    if (!e && data) setOrders(data as unknown as BoardOrder[]);
  }, [restaurantId, since]);

  // Live updates: push from the database, plus a poll every 10 s in case the connection drops.
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb.channel(`orders-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, () => void refresh())
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { void sb.removeChannel(channel); clearInterval(poll); clearInterval(tick); };
  }, [restaurantId, refresh]);

  const newOrders = orders.filter((o) => o.status === 'placed');
  const preparing = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing');
  const ready = orders.filter((o) => o.status === 'ready');
  const recent = orders.filter((o) => !ACTIVE.includes(o.status)).slice(0, 15);
  const ringing = started && newOrders.some((o) => !silencedIds.has(o.id));

  // The alarm: a two-tone chime every 3 s while a new order is waiting (like a delivery tablet).
  useEffect(() => {
    if (!ringing || !audio.current) return;
    const ctx = audio.current;
    const chime = () => {
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.22;
        gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(gain).connect(ctx.destination); osc.start(t); osc.stop(t + 0.45);
      });
    };
    chime();
    const t = setInterval(chime, 3000);
    return () => clearInterval(t);
  }, [ringing]);

  // Tab title + system notification so a new order is noticed even in another tab.
  const seen = useRef(new Set(initialOrders.map((o) => o.id)));
  useEffect(() => {
    document.title = newOrders.length ? `(${newOrders.length}) New order${newOrders.length > 1 ? 's' : ''} · CRAVE` : 'Orders · CRAVE';
    for (const o of newOrders) {
      if (seen.current.has(o.id)) continue;
      seen.current.add(o.id);
      if (started && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification(`New CRAVE order ${o.order_number}`, { body: `${(o.order_items ?? []).reduce((n, i) => n + i.quantity, 0)} items for ${o.pickup_name}` });
      }
    }
  }, [newOrders, started]);

  async function start() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio.current = new Ctx();
    await audio.current.resume().catch(() => {});
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    // Keep a tablet's screen awake while the order screen is open.
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
    void nav.wakeLock?.request('screen').catch(() => {});
    setStarted(true);
  }

  async function run(id: string, fn: () => Promise<{ error?: string }>) {
    setBusy(id); setError(null);
    const r = await fn().catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'Something went wrong' }));
    if (r.error) setError(r.error);
    await refresh();
    setBusy(null);
  }

  const decline = (o: BoardOrder, kind: 'rejected' | 'cancelled') => {
    const reason = window.prompt(kind === 'rejected' ? `Why are you declining ${o.order_number}? (sent to the customer)` : `Why are you cancelling ${o.order_number}? (sent to the customer)`,
      kind === 'rejected' ? 'Sorry, we’re too busy right now' : 'Sorry, we can’t make this order');
    if (reason?.trim()) void run(o.id, () => setOrderStatus(restaurantId, o.id, kind, reason));
  };

  const toggleAccepting = () => location && void run('pause', async () => {
    const r = await setAcceptingOrders(restaurantId, location.id, !accepting);
    if (!r.error) setAccepting(!accepting);
    return r;
  });

  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!started ? (
        <div className="start-overlay" role="dialog" aria-label="Start taking orders">
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 420 }}>
            <div style={{ fontSize: 56 }} aria-hidden>🔔</div>
            <h2 style={{ margin: 0, fontSize: 28 }}>Ready to take orders?</h2>
            <p className="muted" style={{ margin: 0 }}>Tap start so this screen can ring loudly when a new order comes in. Keep it open on a tablet or phone at the counter, with the volume up.</p>
            <button className="btn big" onClick={() => void start()}>Start taking orders</button>
          </div>
        </div>
      ) : null}

      <div className="board-bar">
        <div className="row" style={{ gap: 10 }}>
          <span className={`dot ${live ? 'on' : ''}`} aria-hidden />
          <span className="muted">{live ? 'Live' : 'Connecting…'}</span>
          {location ? (
            <button className={`pill ${accepting ? 'pill-on' : 'pill-off'}`} onClick={toggleAccepting} disabled={busy === 'pause'}
              aria-pressed={accepting} title={accepting ? 'Tap to pause new orders' : 'Tap to start taking orders again'}>
              {accepting ? '● Taking orders' : '❚❚ Paused — tap to resume'}
            </button>
          ) : <span className="badge warn">Add a location to take orders</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {ringing ? <button className="btn secondary" onClick={() => setSilencedIds(new Set(newOrders.map((o) => o.id)))}>🔕 Silence</button> : null}
          <button className="btn secondary" onClick={fullscreen}>⛶ Full screen</button>
        </div>
      </div>

      {error ? <div className="notice" role="alert">{error}</div> : null}

      <div className="board">
        <Column title="New" count={newOrders.length} tone="accent" empty={accepting ? 'Waiting for orders… this screen will ring.' : 'Orders are paused.'}>
          {newOrders.map((o) => (
            <OrderCard key={o.id} o={o} now={now} highlight>
              <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Ready in…</div>
              <div className="prep-grid">
                {PREP_CHOICES.map((m) => (
                  <button key={m} className={`btn ${m === (location?.prepMinutes ?? 15) ? '' : 'secondary'}`} disabled={busy === o.id}
                    onClick={() => void run(o.id, () => acceptOrder(restaurantId, o.id, m))}>{m} min</button>
                ))}
              </div>
              <button className="btn danger" disabled={busy === o.id} onClick={() => decline(o, 'rejected')}>Decline</button>
            </OrderCard>
          ))}
        </Column>

        <Column title="Preparing" count={preparing.length} empty="Accepted orders show here.">
          {preparing.map((o) => {
            const left = minsUntil(o.estimated_ready_at, now);
            return (
              <OrderCard key={o.id} o={o} now={now}>
                {left != null ? <div className={`due ${left < 0 ? 'late' : ''}`}>{left < 0 ? `${-left} min late` : `Ready in ${left} min`} · {clock(o.estimated_ready_at)}</div> : null}
                <button className="btn big" disabled={busy === o.id} onClick={() => void run(o.id, () => setOrderStatus(restaurantId, o.id, 'ready'))}>Mark ready</button>
                <button className="btn danger" disabled={busy === o.id} onClick={() => decline(o, 'cancelled')}>Cancel order</button>
              </OrderCard>
            );
          })}
        </Column>

        <Column title="Ready for pickup" count={ready.length} tone="ok" empty="Orders waiting to be collected.">
          {ready.map((o) => (
            <OrderCard key={o.id} o={o} now={now}>
              <button className="btn big" disabled={busy === o.id} onClick={() => void run(o.id, () => setOrderStatus(restaurantId, o.id, 'completed'))}>
                {o.fulfilment === 'delivery' ? 'Handed to courier' : 'Picked up'}
              </button>
            </OrderCard>
          ))}
        </Column>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Earlier today ({recent.length})</summary>
        {recent.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table style={{ marginTop: 12 }}><thead><tr><th>Order</th><th>Name</th><th>Status</th><th>Food</th><th>Your net</th><th>Note</th></tr></thead><tbody>
            {recent.map((o) => (
              <tr key={o.id}><td>{o.order_number}</td><td>{o.pickup_name}</td><td>{DONE_LABEL[o.status] ?? o.status}</td>
                <td>{formatMoney(o.subtotal_cents)}</td><td>{formatMoney(o.restaurant_net_cents)}</td><td className="muted">{o.cancel_reason ?? ''}</td></tr>
            ))}
          </tbody></table>
        )}
      </details>
    </div>
  );
}

function Column({ title, count, tone, empty, children }: { title: string; count: number; tone?: 'accent' | 'ok'; empty: string; children: React.ReactNode }) {
  return (
    <section className="board-col" aria-label={`${title}: ${count}`}>
      <h2 className="board-col-title">{title} <span className={`count ${tone ?? ''}`}>{count}</span></h2>
      {count === 0 ? <p className="muted" style={{ margin: 0 }}>{empty}</p> : children}
    </section>
  );
}

function OrderCard({ o, now, highlight, children }: { o: BoardOrder; now: number; highlight?: boolean; children: React.ReactNode }) {
  const d = delivery(o);
  const items = o.order_items ?? [];
  const count = items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className={`ocard ${highlight ? 'ocard-new' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 22 }}>{o.pickup_name}</strong>
        <span className="muted">{o.order_number}</span>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {o.fulfilment === 'delivery' ? '🛵 Delivery' : '🛍 Pickup'} · {count} item{count === 1 ? '' : 's'} · {o.scheduled_for ? `for ${clock(o.scheduled_for)}` : 'ASAP'} · {minsSince(o.placed_at, now)} min ago
        {o.source_video_id ? ' · from a CRAVE video' : ''}
      </div>
      {d ? <div className="notice">Courier {d.courier_name ? `${d.courier_name} ` : ''}({d.status.replace('_', ' ')}) — hand it only to the delivery partner.</div> : null}
      <ul className="items">
        {items.map((i, idx) => (
          <li key={idx}>
            <span className="qty">{i.quantity}×</span> <strong>{i.name}</strong>
            {(i.options ?? []).length ? <div className="muted">{(i.options ?? []).map((x) => x.name).join(' · ')}</div> : null}
            {i.notes ? <div className="item-note">“{i.notes}”</div> : null}
          </li>
        ))}
      </ul>
      {o.customer_note ? <div className="notice">Note: {o.customer_note}</div> : null}
      <div className="muted" style={{ fontSize: 13 }}>Food {formatMoney(o.subtotal_cents)} · you receive {formatMoney(o.restaurant_net_cents)}</div>
      {children}
    </article>
  );
}
