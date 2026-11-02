import { formatMoney } from '@crave/core';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const requested = Number((await searchParams).days);
  const days = [1, 7, 30].includes(requested) ? requested : 7;
  const supabase = await supabaseServer();
  const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000);
  const { data: m, error } = await supabase.rpc('admin_platform_metrics', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error || !m) return <div className="card error">Could not load metrics: {error?.message}</div>;
  const q = [
    ['Verifications awaiting review', m.pendingVerifications, '/admin/verifications'],
    ['Videos awaiting moderation', m.videosPendingReview, '/admin/videos'],
    ['Open content reports', m.openReports, '/admin/reports'],
    ['Open appeals', m.openAppeals, '/admin/reports'],
    ['Open refunds', m.refundsOpen, '/admin/refunds'],
    ['Open fraud flags', m.openFraudFlags, '/admin/fraud'],
  ] as const;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Platform overview</h1>
        <div className="row">{[1, 7, 30].map((d) => <Link key={d} href={`?days=${d}`} className={`btn ${d === days ? '' : 'secondary'}`}>{d === 1 ? '24 h' : `${d} days`}</Link>)}</div>
      </div>
      {m.testModeOrders > 0 ? <p className="notice">{m.testModeOrders} of {m.orders} orders in this period used simulated (test) payments — not real revenue.</p> : null}
      <div className="grid">
        <Stat label="Orders" value={String(m.orders)} sub={`${m.ordersFromVideosPct}% started from a video`} />
        <Stat label="Gross order value" value={formatMoney(m.gmvCents)} />
        <Stat label="Commission" value={formatMoney(m.commissionCents)} />
        <Stat label="Service fees" value={formatMoney(m.serviceFeeCents)} />
        <Stat label="Refunds requested" value={formatMoney(m.refundsRequestedCents)} />
        <Stat label="New customers" value={String(m.newUsers)} sub={`${m.activeRestaurants} live restaurants`} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Work queues</h2>
        {q.map(([label, n, href]) => <div key={label} className="row"><span className={`badge ${n ? 'warn' : 'ok'}`}>{n}</span><Link href={href}>{label}</Link></div>)}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="card"><div className="muted">{label}</div><div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>{sub ? <div className="muted" style={{ fontSize: 13 }}>{sub}</div> : null}</div>;
}
