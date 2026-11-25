import { formatMoney } from '@crave/core';
import Link from 'next/link';
import { loadMemberRestaurant } from '@/lib/restaurant';
import { setupProgress } from '@/lib/setup-progress';
import { LineIcon } from '@/components/line-icon';
import { StoreControls } from './store-controls';

/** Brisbane has no daylight saving: "today" starts at 00:00 UTC+10. */
function brisbaneMidnight(now = new Date()): Date {
  const b = new Date(now.getTime() + 10 * 3600_000);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - 10 * 3600_000);
}

const COUNTED = ['placed', 'accepted', 'preparing', 'ready', 'completed'];

/** Store home: is the store taking orders, today's numbers, and shortcuts (Uber Eats Manager style). */
export default async function StoreHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, restaurant } = await loadMemberRestaurant(id);
  const base = `/restaurant/${id}`;
  const [{ data: loc }, { data: today }, pendingTags, { count: menuCount }, progress] = await Promise.all([
    supabase.from('restaurant_locations').select('id, is_accepting_orders, prep_time_minutes, busy_extra_minutes, busy_until').eq('restaurant_id', id).order('created_at').limit(1).maybeSingle(),
    supabase.from('orders').select('status, subtotal_cents, restaurant_net_cents, order_items(name, quantity)')
      .eq('restaurant_id', id).gte('placed_at', brisbaneMidnight().toISOString()),
    supabase.from('video_menu_items').select('video_id', { count: 'exact', head: true }).eq('restaurant_id', id).eq('status', 'pending'),
    supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
    setupProgress(supabase, restaurant),
  ]);
  const openNow = loc ? (await supabase.rpc('location_is_open', { p_location_id: loc.id })).data === true : false;
  const busyExtra = loc?.busy_until && new Date(loc.busy_until) > new Date() ? loc.busy_extra_minutes : 0;

  const orders = (today ?? []).filter((o) => COUNTED.includes(o.status));
  const waiting = orders.filter((o) => o.status === 'placed').length;
  const inProgress = orders.filter((o) => ['accepted', 'preparing', 'ready'].includes(o.status)).length;
  const sales = orders.reduce((n, o) => n + o.subtotal_cents, 0);
  const net = orders.reduce((n, o) => n + o.restaurant_net_cents, 0);
  const dishCounts = new Map<string, number>();
  for (const o of orders) for (const i of (o.order_items ?? []) as { name: string; quantity: number }[]) dishCounts.set(i.name, (dishCounts.get(i.name) ?? 0) + i.quantity);
  const top = [...dishCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="stack" style={{ gap: 20 }}>
      {restaurant.status !== 'verified' ? (
        <div className="card stack" style={{ gap: 10, borderColor: 'var(--accent)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 18 }}>{progress.doneCount === progress.total ? 'Setup complete — CRAVE is reviewing your store' : 'Finish setting up your store'}</strong>
            <span className="muted">{progress.doneCount} of {progress.total} done</span>
          </div>
          <div className="progress"><span style={{ width: `${(progress.doneCount / progress.total) * 100}%` }} /></div>
          <span className="muted">Customers can’t see {restaurant.name} until setup is finished and CRAVE approves it — usually within 1–2 business days.</span>
          {progress.nextStep ? <div><Link className="btn" href={`${base}/setup?step=${progress.nextStep}`}>Continue setup →</Link></div> : null}
        </div>
      ) : null}

      {waiting ? (
        <Link href={`${base}/orders`} className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', borderColor: 'var(--accent)', background: 'rgba(255,77,46,.12)' }}>
          <strong style={{ fontSize: 18 }}>{waiting} new order{waiting > 1 ? 's' : ''} waiting</strong>
          <span className="btn">Open orders</span>
        </Link>
      ) : null}

      <div className="card">
        {loc ? (
          <StoreControls restaurantId={id} location={{ id: loc.id, accepting: loc.is_accepting_orders, openNow, prepMinutes: loc.prep_time_minutes + busyExtra, busyExtra: loc.busy_extra_minutes, busyUntil: loc.busy_until }} />
        ) : <p className="muted" style={{ margin: 0 }}>No location yet — finish setup to start taking orders.</p>}
      </div>

      <section className="stack" aria-labelledby="today">
        <h2 id="today" style={{ margin: 0 }}>Today</h2>
        <div className="grid">
          <div className="card"><div className="muted">Orders</div><div className="stat">{orders.length}</div><div className="muted">{inProgress} in progress</div></div>
          <div className="card"><div className="muted">Food sales</div><div className="stat">{formatMoney(sales)}</div><div className="muted">incl. GST</div></div>
          <div className="card"><div className="muted">You receive</div><div className="stat">{formatMoney(net)}</div><div className="muted">after {(restaurant.commission_rate_bps / 100).toFixed(1)}% commission</div></div>
          <div className="card"><div className="muted">Top dish</div><div className="stat" style={{ fontSize: 20, lineHeight: 1.3 }}>{top ? top[0] : '—'}</div><div className="muted">{top ? `${top[1]} sold` : 'No orders yet'}</div></div>
        </div>
      </section>

      <section className="stack" aria-labelledby="manage">
        <h2 id="manage" style={{ margin: 0 }}>Manage your store</h2>
        <div className="tiles">
          <Link className="tile" href={`${base}/orders`}><span className="tile-icon"><LineIcon name="bell" size={20} /></span><strong>Orders</strong><span className="muted">The counter screen that rings</span></Link>
          <Link className="tile" href={`${base}/menu`}><span className="tile-icon"><LineIcon name="menu" size={20} /></span><strong>Menu</strong><span className="muted">{menuCount ?? 0} dishes · prices, photos, sold out</span></Link>
          <Link className="tile" href={`${base}/hours`}><span className="tile-icon"><LineIcon name="clock" size={20} /></span><strong>Hours</strong><span className="muted">Opening hours and prep time</span></Link>
          <Link className="tile" href={`${base}/content`}><span className="tile-icon"><LineIcon name="film" size={20} /></span><strong>Videos</strong><span className="muted">{pendingTags.count ? `${pendingTags.count} waiting for your approval` : 'Videos featuring your dishes'}</span></Link>
          <Link className="tile" href={`${base}/sales`}><span className="tile-icon"><LineIcon name="chart" size={20} /></span><strong>Sales</strong><span className="muted">Sales, top dishes, video revenue</span></Link>
          <Link className="tile" href={`${base}/payouts`}><span className="tile-icon"><LineIcon name="bank" size={20} /></span><strong>Payouts</strong><span className="muted">{restaurant.payouts_enabled ? 'Bank connected' : 'Connect your bank'}</span></Link>
        </div>
      </section>
    </div>
  );
}
