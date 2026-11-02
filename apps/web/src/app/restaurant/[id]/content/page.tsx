import { canManage, loadMemberRestaurant } from '@/lib/restaurant';
import { decideTag } from './actions';
import { PromoUpload } from './promo-upload';

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role } = await loadMemberRestaurant(id);
  const [{ data: requests }, { data: items }, { data: own }] = await Promise.all([
    supabase.rpc('restaurant_tag_requests', { p_restaurant_id: id }),
    supabase.from('menu_items').select('id, name').eq('restaurant_id', id).order('name'),
    supabase.from('videos').select('id, caption, status, moderation_notes, created_at, video_stats(impressions, likes, right_swipes, orders)').eq('restaurant_id', id).eq('source', 'restaurant').order('created_at', { ascending: false }),
  ]);
  const manage = canManage(role);
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Creator tags</h2>
        <p className="muted" style={{ margin: 0 }}>A video only becomes orderable from your menu after you approve its tag. Check the dish shown matches what you serve.</p>
        {(requests ?? []).length === 0 ? <p className="muted">No creator tags yet.</p> : (
          <table><thead><tr><th>Creator</th><th>Video</th><th>Tagged item</th><th>Status</th><th /></tr></thead><tbody>
            {(requests ?? []).map((r: any) => (
              <tr key={`${r.video_id}-${r.menu_item_id}`}>
                <td>@{r.creator_handle ?? r.creator_display_name ?? 'customer'}</td>
                <td>{r.caption}{r.is_sponsored ? <span className="badge warn" style={{ marginLeft: 6 }}>Sponsored</span> : null}<div className="muted">video {r.video_status.replace('_', ' ')}</div>
                  {r.playback_url ? <a href={r.playback_url} target="_blank" rel="noreferrer">Watch</a> : null}</td>
                <td>{r.menu_item_name}</td>
                <td><span className={`badge ${r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'bad'}`}>{r.status}</span></td>
                <td>{manage && r.status === 'pending' ? (
                  <div className="row">
                    <form action={decideTag.bind(null, id, r.video_id, r.menu_item_id, true)}><button className="btn" style={{ minHeight: 34 }}>Approve</button></form>
                    <form action={decideTag.bind(null, id, r.video_id, r.menu_item_id, false)}><button className="btn danger" style={{ minHeight: 34 }}>Reject</button></form>
                  </div>
                ) : null}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Your videos</h2>
        {(own ?? []).length === 0 ? <p className="muted">No videos uploaded. Videos are optional — your photo menu works without them.</p> : (
          <table><thead><tr><th>Caption</th><th>Status</th><th>Impressions</th><th>Craves</th><th>Likes</th></tr></thead><tbody>
            {(own ?? []).map((v: any) => (
              <tr key={v.id}><td>{v.caption ?? '—'}</td><td>{v.status.replace('_', ' ')}{v.moderation_notes ? <div className="muted">{v.moderation_notes}</div> : null}</td>
                <td>{v.video_stats?.impressions ?? 0}</td><td>{v.video_stats?.right_swipes ?? 0}</td><td>{v.video_stats?.likes ?? 0}</td></tr>
            ))}
          </tbody></table>
        )}
        {manage ? <><h3 style={{ marginBottom: 0 }}>Upload an existing promo video</h3><PromoUpload restaurantId={id} items={items ?? []} /></> : null}
      </div>
    </div>
  );
}
