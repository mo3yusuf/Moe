import { formatMoney } from '@crave/core';
import Link from 'next/link';
import { loadMemberRestaurant } from '@/lib/restaurant';

export default async function RestaurantOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, restaurant } = await loadMemberRestaurant(id);
  const [items, hours, pendingTags, verification] = await Promise.all([
    supabase.from('menu_items').select('id, price_cents, is_available, image_url').eq('restaurant_id', id),
    supabase.from('location_opening_hours').select('id, restaurant_locations!inner(restaurant_id)').eq('restaurant_locations.restaurant_id', id),
    supabase.from('video_menu_items').select('video_id', { count: 'exact', head: true }).eq('restaurant_id', id).eq('status', 'pending'),
    supabase.from('restaurant_verifications').select('status, submitted_at, reviewer_notes').eq('restaurant_id', id).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const menu = items.data ?? [];
  const checklist = [
    { done: menu.length >= 3, label: 'Add at least 3 menu items', href: 'menu' },
    { done: menu.length > 0 && menu.every((m) => m.image_url), label: 'Add a photo to every item (shown when no video exists)', href: 'menu' },
    { done: (hours.data ?? []).length > 0, label: 'Set opening hours', href: 'hours' },
    { done: !!verification.data, label: 'Submit verification documents', href: 'verification' },
  ];
  const avg = menu.length ? Math.round(menu.reduce((a, m) => a + m.price_cents, 0) / menu.length) : 0;
  return (
    <div className="stack">
      {restaurant.status !== 'verified' ? (
        <div className="notice">Customers can’t see {restaurant.name} until CRAVE verifies it. Complete the checklist below.</div>
      ) : null}
      <div className="grid">
        <div className="card"><div className="muted">Menu items</div><div style={{ fontSize: 30, fontWeight: 800 }}>{menu.length}</div><div className="muted">{menu.filter((m) => !m.is_available).length} unavailable</div></div>
        <div className="card"><div className="muted">Average item price</div><div style={{ fontSize: 30, fontWeight: 800 }}>{menu.length ? formatMoney(avg) : '—'}</div></div>
        <div className="card"><div className="muted">Creator tags awaiting approval</div><div style={{ fontSize: 30, fontWeight: 800 }}>{pendingTags.count ?? 0}</div><Link href={`/restaurant/${id}/content`}>Review</Link></div>
        <div className="card"><div className="muted">Commission</div><div style={{ fontSize: 30, fontWeight: 800 }}>{(restaurant.commission_rate_bps / 100).toFixed(1)}%</div><div className="muted">per order, set by agreement</div></div>
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Getting started</h2>
        {checklist.map((c) => (
          <div key={c.label} className="row"><span className={`badge ${c.done ? 'ok' : ''}`}>{c.done ? 'Done' : 'To do'}</span><Link href={`/restaurant/${id}/${c.href}`}>{c.label}</Link></div>
        ))}
        {verification.data ? <p className="muted" style={{ margin: 0 }}>Verification: {verification.data.status.replace('_', ' ')}{verification.data.reviewer_notes ? ` — ${verification.data.reviewer_notes}` : ''}</p> : null}
      </div>
      <p className="muted" style={{ margin: 0 }}>Sales, orders and video performance reports arrive with ordering (Phases 5–6).</p>
    </div>
  );
}
