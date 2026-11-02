import { formatMoney } from '@crave/core';
import { apiFetch } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase/server';

interface Recon { stripeCount: number; stripeTotalCents: number; matchedCents: number; issues: { intentId: string; problem: string; stripeAmount?: number; ourAmount?: number; orderNumber?: string }[] }

export default async function Payments({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const yesterday = new Date(Date.now() + 10 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test((await searchParams).date ?? '') ? (await searchParams).date! : yesterday;
  const supabase = await supabaseServer();
  const [{ data: disputes }, { data: webhooks }] = await Promise.all([
    supabase.from('payment_disputes').select('provider_dispute_id, amount_cents, reason, status, evidence_due_by, payments(orders(order_number, restaurants(name)))').order('created_at', { ascending: false }).limit(50),
    supabase.from('webhook_events').select('id, type, error, received_at').not('error', 'is', null).is('processed_at', null).order('received_at', { ascending: false }).limit(20),
  ]);
  let recon: Recon | null = null; let reconError: string | null = null;
  try { recon = await apiFetch<Recon>(`/v1/admin/reconciliation?date=${date}`); } catch (e) { reconError = (e as Error).message; }
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Payments</h1>
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Daily reconciliation (Brisbane day)</h2>
          <form className="row"><input type="date" name="date" defaultValue={date} /><button className="btn secondary">Check</button></form>
        </div>
        {reconError ? <p className="error">{reconError}</p> : recon ? (
          <>
            <p style={{ margin: 0 }}>Stripe: {recon.stripeCount} payments, {formatMoney(recon.stripeTotalCents)} · matched {formatMoney(recon.matchedCents)}</p>
            {recon.issues.length === 0 ? <p style={{ color: 'var(--success)', margin: 0 }}>No discrepancies.</p> : (
              <table><thead><tr><th>Intent</th><th>Order</th><th>Problem</th><th>Stripe</th><th>CRAVE</th></tr></thead><tbody>
                {recon.issues.map((i) => <tr key={i.intentId + i.problem}><td>{i.intentId}</td><td>{i.orderNumber ?? '—'}</td><td>{i.problem}</td>
                  <td>{i.stripeAmount != null ? formatMoney(i.stripeAmount) : '—'}</td><td>{i.ourAmount != null ? formatMoney(i.ourAmount) : '—'}</td></tr>)}
              </tbody></table>
            )}
          </>
        ) : null}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Disputes (chargebacks)</h2>
        <p className="muted" style={{ margin: 0 }}>Respond with evidence in the Stripe Dashboard before the due date (order record, pickup time, restaurant confirmation).</p>
        {(disputes ?? []).length === 0 ? <p className="muted">None.</p> : (
          <table><thead><tr><th>Order</th><th>Amount</th><th>Reason</th><th>Status</th><th>Evidence due</th></tr></thead><tbody>
            {(disputes ?? []).map((d: any) => <tr key={d.provider_dispute_id}><td>{d.payments?.orders?.order_number}<div className="muted">{d.payments?.orders?.restaurants?.name}</div></td>
              <td>{formatMoney(d.amount_cents)}</td><td>{d.reason}</td><td>{d.status}</td><td>{d.evidence_due_by ? new Date(d.evidence_due_by).toLocaleDateString('en-AU') : '—'}</td></tr>)}
          </tbody></table>
        )}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Failed webhook deliveries</h2>
        {(webhooks ?? []).length === 0 ? <p className="muted">None — Stripe retries failed deliveries automatically for up to 3 days.</p> : (
          <table><tbody>{(webhooks ?? []).map((w) => <tr key={w.id}><td>{w.type}</td><td className="muted">{w.error}</td><td>{new Date(w.received_at).toLocaleString('en-AU')}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
  );
}
