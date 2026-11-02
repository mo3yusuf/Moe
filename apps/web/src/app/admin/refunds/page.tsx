import { formatMoney } from '@crave/core';
import { supabaseServer } from '@/lib/supabase/server';
import { decideRefund } from '../actions';

export default async function Refunds() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from('refunds').select('id, amount_cents, reason, details, status, created_at, orders(order_number, restaurants(name)), payments(provider, is_test_mode)')
    .order('created_at', { ascending: false }).limit(100);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Refunds</h1>
      <p className="muted">Refunds for customer cancellations and restaurant rejections are sent automatically. Others need approval here; approved refunds are sent to Stripe within a minute. Test-mode (simulated) refunds complete instantly with no money moved.</p>
      <table><thead><tr><th>Order</th><th>Amount</th><th>Reason</th><th>Status</th><th>Decision</th></tr></thead><tbody>
        {(data ?? []).map((r: any) => (
          <tr key={r.id}>
            <td>{r.orders?.order_number}<div className="muted">{r.orders?.restaurants?.name}{r.payments?.is_test_mode ? ' · test payment' : ''}</div></td>
            <td>{formatMoney(r.amount_cents)}</td>
            <td>{r.reason}{r.details ? <div className="muted">{r.details}</div> : null}</td>
            <td>{r.status}</td>
            <td>{r.status === 'requested' ? (
              <div className="stack" style={{ gap: 6 }}>
                <form action={decideRefund.bind(null, r.id, true)}><button className="btn" style={{ minHeight: 34 }}>Approve</button></form>
                <form action={decideRefund.bind(null, r.id, false)} className="row" style={{ flexWrap: 'nowrap' }}><input name="notes" placeholder="Reason" required /><button className="btn danger" style={{ minHeight: 34 }}>Reject</button></form>
              </div>
            ) : null}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
