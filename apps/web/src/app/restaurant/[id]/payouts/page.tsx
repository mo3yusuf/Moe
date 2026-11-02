import { formatMoney } from '@crave/core';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { openDashboard, startOnboarding } from './actions';

export default async function Payouts({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; refresh?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, restaurant, role } = await loadMemberRestaurant(id);
  if (role !== 'owner') return <div className="card">Only the restaurant owner can manage payouts.</div>;
  const { data: payouts } = await supabase.from('restaurant_payouts').select('provider_payout_id, amount_cents, currency, status, arrival_date, created_at').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(50);
  const connected = !!restaurant.stripe_account_id;
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Card payments & payouts</h2>
        <p className="muted" style={{ margin: 0 }}>
          CRAVE uses Stripe to take card payments. Customers pay CRAVE; Stripe sends your share (food sales minus the {(restaurant.commission_rate_bps / 100).toFixed(1)}% commission) to your bank account.
          Stripe will ask for your business details and bank account — CRAVE never sees your bank details.
        </p>
        {sp.done && !restaurant.payouts_enabled ? <p className="notice">Thanks — Stripe is reviewing your details. This page updates automatically when it’s approved.</p> : null}
        {sp.refresh ? <p className="notice">Your Stripe link expired. Continue below.</p> : null}
        <div className="row">
          <span className={`badge ${restaurant.payouts_enabled ? 'ok' : 'warn'}`}>{restaurant.payouts_enabled ? 'Ready to take card orders' : connected ? 'Stripe setup incomplete' : 'Not connected'}</span>
        </div>
        <div className="row">
          {!restaurant.payouts_enabled ? <form action={startOnboarding.bind(null, id)}><button className="btn">{connected ? 'Continue Stripe setup' : 'Set up payouts with Stripe'}</button></form> : null}
          {connected ? <form action={openDashboard.bind(null, id)}><button className="btn secondary">Open Stripe dashboard</button></form> : null}
        </div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Payouts</h2>
        {(payouts ?? []).length === 0 ? <p className="muted">No payouts yet.</p> : (
          <table><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Arrives</th></tr></thead><tbody>
            {(payouts ?? []).map((p) => <tr key={p.provider_payout_id}><td>{new Date(p.created_at).toLocaleDateString('en-AU')}</td><td>{formatMoney(p.amount_cents, p.currency)}</td><td>{p.status.replace('_', ' ')}</td><td>{p.arrival_date ?? '—'}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
