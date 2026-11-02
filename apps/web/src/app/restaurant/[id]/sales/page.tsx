import { formatMoney } from '@crave/core';
import Link from 'next/link';
import { canManage, loadMemberRestaurant } from '@/lib/restaurant';

interface Report {
  orders: number; grossSalesCents: number; commissionCents: number; netCents: number; averageOrderCents: number;
  rejected: number; cancelled: number; refundedCents: number; fromVideosCents: number; fromCreatorsCents: number;
  daily: { date: string; orders: number; salesCents: number; netCents: number }[];
  topItems: { name: string; quantity: number; salesCents: number }[];
  videos: { videoId: string; caption: string | null; source: string; creatorHandle: string | null; orders: number; salesCents: number; attributedCents: number; impressions: number | null; rightSwipes: number | null }[];
}
const RANGES = [7, 30, 90] as const;

export default async function SalesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const { id } = await params;
  const requested = (await searchParams).days;
  const days = RANGES.find((d) => String(d) === requested) ?? 30;
  const { supabase, role, restaurant } = await loadMemberRestaurant(id);
  if (!canManage(role)) return <div className="card">Sales reports are available to owners and managers.</div>;
  const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000);
  const { data, error } = await supabase.rpc('restaurant_sales_report', { p_restaurant_id: id, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error || !data) return <div className="card error">Could not load sales: {error?.message}</div>;
  const r = data as Report;
  const max = Math.max(1, ...r.daily.map((d) => d.salesCents));
  const pct = (n: number) => (r.grossSalesCents ? Math.round((100 * n) / r.grossSalesCents) : 0);
  return (
    <div className="stack">
      <div className="row">{RANGES.map((d) => <Link key={d} href={`?days=${d}`} className={`btn ${d === days ? '' : 'secondary'}`}>Last {d} days</Link>)}</div>
      <div className="grid">
        <Stat label="Orders" value={String(r.orders)} sub={`${r.rejected} declined · ${r.cancelled} cancelled`} />
        <Stat label="Food sales (GST incl.)" value={formatMoney(r.grossSalesCents)} sub={`Avg ${formatMoney(r.averageOrderCents)}`} />
        <Stat label="CRAVE commission" value={formatMoney(r.commissionCents)} sub={`${(restaurant.commission_rate_bps / 100).toFixed(1)}% current rate`} />
        <Stat label="Your net (before card fees)" value={formatMoney(r.netCents)} sub={r.refundedCents ? `Refunded ${formatMoney(r.refundedCents)}` : undefined} />
        <Stat label="Sales from videos" value={formatMoney(r.fromVideosCents)} sub={`${pct(r.fromVideosCents)}% of sales`} />
        <Stat label="From creator content" value={formatMoney(r.fromCreatorsCents)} sub={`${pct(r.fromCreatorsCents)}% of sales`} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Daily sales</h2>
        {r.daily.length === 0 ? <p className="muted">No orders in this period.</p> : (
          <div role="img" aria-label="Daily sales bar chart" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
            {r.daily.map((d) => (
              <div key={d.date} title={`${d.date}: ${formatMoney(d.salesCents)} (${d.orders} orders)`}
                style={{ flex: 1, minWidth: 6, height: `${Math.max(2, (100 * d.salesCents) / max)}%`, background: 'var(--accent)', borderRadius: 4 }} />
            ))}
          </div>
        )}
        <table><thead><tr><th>Date</th><th>Orders</th><th>Sales</th><th>Net</th></tr></thead><tbody>
          {[...r.daily].reverse().map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{formatMoney(d.salesCents)}</td><td>{formatMoney(d.netCents)}</td></tr>)}
        </tbody></table>
      </div>
      <div className="grid">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Top items</h2>
          <table><thead><tr><th>Item</th><th>Qty</th><th>Sales</th></tr></thead><tbody>
            {r.topItems.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.quantity}</td><td>{formatMoney(t.salesCents)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Videos that generated sales</h2>
          {r.videos.length === 0 ? <p className="muted">No orders from videos yet.</p> : (
            <table><thead><tr><th>Video</th><th>By</th><th>Orders</th><th>Sales</th><th>Craves</th></tr></thead><tbody>
              {r.videos.map((v) => <tr key={v.videoId}><td>{v.caption ?? '—'}</td><td>{v.source === 'restaurant' ? 'You' : v.creatorHandle ? `@${v.creatorHandle}` : 'Customer'}</td>
                <td>{v.orders}</td><td>{formatMoney(v.salesCents)}</td><td>{v.rightSwipes ?? 0}</td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Card processing fees and payouts appear once live payments are enabled. Figures include test-mode orders until then.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="card"><div className="muted">{label}</div><div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>{sub ? <div className="muted" style={{ fontSize: 13 }}>{sub}</div> : null}</div>;
}
