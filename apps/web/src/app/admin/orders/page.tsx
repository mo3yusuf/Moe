import { formatMoney, ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@crave/core';
import { supabaseServer } from '@/lib/supabase/server';
import { createRefund } from '../actions';

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const supabase = await supabaseServer();
  let query = supabase.from('orders').select('id, order_number, status, created_at, total_cents, subtotal_cents, commission_cents, pickup_name, cancel_reason, restaurants(name), payments(provider, status, is_test_mode), refunds(amount_cents, status)')
    .order('created_at', { ascending: false }).limit(100);
  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  if (q) query = query.ilike('order_number', `%${q.trim()}%`);
  const { data, error } = await query;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Orders</h1>
      <form className="row">
        <input name="q" defaultValue={q} placeholder="Order number" style={{ maxWidth: 200 }} />
        <select name="status" defaultValue={status ?? ''} style={{ maxWidth: 220 }}><option value="">All statuses</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}</select>
        <button className="btn secondary">Filter</button>
      </form>
      {error ? <p className="error">{error.message}</p> : null}
      <table><thead><tr><th>Order</th><th>Restaurant</th><th>Status</th><th>Total</th><th>Commission</th><th>Payment</th><th>Refunds</th><th>Refund</th></tr></thead><tbody>
        {(data ?? []).map((o: any) => {
          const pay = o.payments?.[0];
          const refunded = (o.refunds ?? []).filter((r: any) => r.status !== 'rejected' && r.status !== 'failed').reduce((a: number, r: any) => a + r.amount_cents, 0);
          return (
            <tr key={o.id}>
              <td>{o.order_number}<div className="muted">{new Date(o.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}</div></td>
              <td>{o.restaurants?.name}</td>
              <td>{ORDER_STATUS_LABELS[o.status as OrderStatus]}{o.cancel_reason ? <div className="muted">{o.cancel_reason}</div> : null}</td>
              <td>{formatMoney(o.total_cents)}</td><td>{formatMoney(o.commission_cents)}</td>
              <td>{pay ? `${pay.provider}${pay.is_test_mode ? ' (test)' : ''} · ${pay.status}` : '—'}</td>
              <td>{refunded ? formatMoney(refunded) : '—'}</td>
              <td>{pay?.status === 'succeeded' && refunded < o.total_cents ? (
                <form action={createRefund.bind(null, o.id)} className="row" style={{ flexWrap: 'nowrap' }}>
                  <input name="amount" placeholder="$" style={{ width: 80 }} required />
                  <select name="reason" style={{ width: 140 }}>{['quality_issue', 'item_unavailable', 'customer_request', 'duplicate', 'fraud', 'other'].map((r) => <option key={r}>{r}</option>)}</select>
                  <button className="btn secondary" style={{ minHeight: 34 }}>Refund</button>
                </form>
              ) : null}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}
