import { supabaseServer } from '@/lib/supabase/server';
import { updateCreator } from '../actions';

export default async function Creators({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const filter = (await searchParams).filter;
  const supabase = await supabaseServer();
  let q = supabase.from('creators').select('user_id, handle, is_verified, affiliate_status, affiliate_commission_bps, affiliate_applied_at, created_at').order('affiliate_applied_at', { ascending: false, nullsFirst: false }).limit(200);
  if (filter === 'applied') q = q.eq('affiliate_status', 'applied');
  const { data: creators } = await q;
  const ids = (creators ?? []).map((c) => c.user_id);
  const { data: comms } = ids.length ? await supabase.from('creator_commissions').select('creator_id, status, amount_cents').in('creator_id', ids) : { data: [] };
  const earned = new Map<string, Record<string, number>>();
  for (const c of (comms ?? []) as any[]) { const e = earned.get(c.creator_id) ?? {}; e[c.status] = (e[c.status] ?? 0) + c.amount_cents; earned.set(c.creator_id, e); }
  const { data: vids } = ids.length ? await supabase.from('videos').select('uploader_id, status, video_stats(views_3s, orders, revenue_cents)').in('uploader_id', ids) : { data: [] };
  const stats = new Map<string, { videos: number; views: number; orders: number }>();
  for (const v of (vids ?? []) as any[]) {
    const s = stats.get(v.uploader_id) ?? { videos: 0, views: 0, orders: 0 };
    s.videos += v.status === 'published' ? 1 : 0; s.views += v.video_stats?.views_3s ?? 0; s.orders += v.video_stats?.orders ?? 0;
    stats.set(v.uploader_id, s);
  }
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h1 style={{ margin: 0 }}>Creators</h1>
        <div className="row"><a className="btn secondary" href="?">All</a><a className="btn secondary" href="?filter=applied">Affiliate applications</a></div></div>
      <p className="muted" style={{ margin: 0 }}>Commissions are created when an attributed order is collected, approved after 7 days without refunds or disputes, and paid daily via Stripe once a creator has $10+ ready. Funded from CRAVE’s commission, never more than it.</p>
      <table><thead><tr><th>Handle</th><th>Live videos</th><th>Views</th><th>Orders</th><th>Commissions (pending / paid)</th><th>Verified · affiliate · commission %</th></tr></thead><tbody>
        {(creators ?? []).map((c) => {
          const s = stats.get(c.user_id) ?? { videos: 0, views: 0, orders: 0 };
          return (
            <tr key={c.user_id}><td>@{c.handle}{c.affiliate_status === 'applied' ? <span className="badge warn" style={{ marginLeft: 6 }}>applied</span> : null}</td>
              <td>{s.videos}</td><td>{s.views}</td><td>{s.orders}</td><td>${((earned.get(c.user_id)?.pending ?? 0) / 100).toFixed(2)} / ${((earned.get(c.user_id)?.paid ?? 0) / 100).toFixed(2)}</td>
              <td><form action={updateCreator.bind(null, c.user_id)} className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="checkbox" name="verified" defaultChecked={c.is_verified} style={{ width: 18, minHeight: 18 }} aria-label="Verified" />
                <select name="affiliate" defaultValue={c.affiliate_status} style={{ width: 130 }}>{['none', 'applied', 'approved', 'rejected', 'suspended'].map((a) => <option key={a}>{a}</option>)}</select>
                <input name="commission" type="number" step="0.5" min={0} max={30} defaultValue={c.affiliate_commission_bps != null ? c.affiliate_commission_bps / 100 : ''} placeholder="%" style={{ width: 70 }} />
                <button className="btn secondary" style={{ minHeight: 34 }}>Save</button>
              </form></td></tr>
          );
        })}
      </tbody></table>
    </div>
  );
}
