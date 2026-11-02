import { formatMoney, ORDER_STATUS_LABELS, type OrderStatus } from '@crave/core';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { updateStatus } from './actions';
import { AutoRefresh } from './auto-refresh';

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready'];
const NEXT: Partial<Record<OrderStatus, { to: 'accepted' | 'preparing' | 'ready' | 'completed'; label: string }>> = {
  placed: { to: 'accepted', label: 'Accept' },
  accepted: { to: 'preparing', label: 'Start preparing' },
  preparing: { to: 'ready', label: 'Mark ready for pickup' },
  ready: { to: 'completed', label: 'Collected' },
};
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' }) : '—');

export default async function OrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await loadMemberRestaurant(id);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: orders } = await supabase.from('orders')
    .select('id, order_number, status, pickup_name, customer_note, scheduled_for, placed_at, estimated_ready_at, subtotal_cents, commission_cents, restaurant_net_cents, cancel_reason, source_video_id, order_items(name, quantity, options, notes)')
    .eq('restaurant_id', id).neq('status', 'pending_payment').gte('created_at', since).order('created_at', { ascending: false });
  const active = (orders ?? []).filter((o) => ACTIVE.includes(o.status));
  const done = (orders ?? []).filter((o) => !ACTIVE.includes(o.status));
  return (
    <div className="stack">
      <AutoRefresh />
      <h2 style={{ margin: 0 }}>Live orders <span className="muted" style={{ fontSize: 14 }}>(refreshes every 15 s)</span></h2>
      {active.length === 0 ? <p className="muted">No active orders.</p> : (
        <div className="grid">
          {active.map((o) => (
            <div key={o.id} className="card stack" style={o.status === 'placed' ? { borderColor: 'var(--accent)' } : undefined}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 20 }}>{o.order_number}</strong>
                <span className={`badge ${o.status === 'placed' ? 'warn' : 'ok'}`}>{ORDER_STATUS_LABELS[o.status as OrderStatus]}</span>
              </div>
              <div>Pickup name: <strong>{o.pickup_name}</strong>{o.scheduled_for ? ` · for ${fmtTime(o.scheduled_for)}` : ' · ASAP'}</div>
              <div className="muted">Placed {fmtTime(o.placed_at)}{o.estimated_ready_at ? ` · ready by ${fmtTime(o.estimated_ready_at)}` : ''}{o.source_video_id ? ' · from a CRAVE video' : ''}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(o.order_items ?? []).map((i: any, idx: number) => (
                  <li key={idx}><strong>{i.quantity} × {i.name}</strong>{(i.options ?? []).length ? ` — ${i.options.map((x: any) => x.name).join(', ')}` : ''}{i.notes ? <div className="muted">“{i.notes}”</div> : null}</li>
                ))}
              </ul>
              {o.customer_note ? <div className="notice">Note: {o.customer_note}</div> : null}
              <div className="muted">Food {formatMoney(o.subtotal_cents)} · commission {formatMoney(o.commission_cents)} · your net {formatMoney(o.restaurant_net_cents)}</div>
              {NEXT[o.status as OrderStatus] ? (
                <form action={updateStatus.bind(null, id, o.id, NEXT[o.status as OrderStatus]!.to, undefined)}><button className="btn">{NEXT[o.status as OrderStatus]!.label}</button></form>
              ) : null}
              <form className="row" action={updateStatus.bind(null, id, o.id, o.status === 'placed' ? 'rejected' : 'cancelled')}>
                <input name="reason" placeholder={o.status === 'placed' ? 'Reason to decline (sent to customer)' : 'Reason to cancel (sent to customer)'} required style={{ flex: 1 }} />
                <button className="btn danger">{o.status === 'placed' ? 'Decline' : 'Cancel'}</button>
              </form>
            </div>
          ))}
        </div>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Last 24 hours</h2>
        {done.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table><thead><tr><th>Order</th><th>Status</th><th>Food</th><th>Net</th><th>Reason</th></tr></thead><tbody>
            {done.map((o) => <tr key={o.id}><td>{o.order_number}</td><td>{ORDER_STATUS_LABELS[o.status as OrderStatus]}</td><td>{formatMoney(o.subtotal_cents)}</td><td>{formatMoney(o.restaurant_net_cents)}</td><td className="muted">{o.cancel_reason ?? ''}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
