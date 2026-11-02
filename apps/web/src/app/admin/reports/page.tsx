import { supabaseServer } from '@/lib/supabase/server';
import { decideAppeal, resolveReport } from '../actions';

export default async function Reports() {
  const supabase = await supabaseServer();
  const [{ data: reports }, { data: appeals }] = await Promise.all([
    supabase.from('content_reports').select('id, target_type, target_id, reason, details, status, created_at').in('status', ['open', 'in_review']).order('created_at'),
    supabase.from('moderation_appeals').select('id, target_type, target_id, body, status, created_at').eq('status', 'open').order('created_at'),
  ]);
  const videoIds = [...(reports ?? []), ...(appeals ?? [])].filter((r) => r.target_type === 'video').map((r) => r.target_id);
  const { data: videos } = videoIds.length ? await supabase.from('videos').select('id, caption, status, playback_url').in('id', videoIds) : { data: [] };
  const video = new Map((videos ?? []).map((v) => [v.id, v]));
  const grouped = Object.values((reports ?? []).reduce<Record<string, NonNullable<typeof reports>>>((a, r) => ((a[`${r.target_type}:${r.target_id}`] ??= []).push(r), a), {}));
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Reports & appeals</h1>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Open reports ({reports?.length ?? 0})</h2>
        {grouped.length === 0 ? <p className="muted">No open reports.</p> : grouped.map((g) => {
          const first = g[0]!; const v = video.get(first.target_id);
          return (
            <div key={first.id} className="card stack" style={{ background: 'var(--surface-2)' }}>
              <strong>{first.target_type}: {v?.caption ?? first.target_id} {v ? <span className="muted">({v.status})</span> : null}</strong>
              {v?.playback_url ? <a href={v.playback_url} target="_blank" rel="noreferrer">Watch</a> : null}
              <div className="muted">{g.length} report(s): {[...new Set(g.map((r) => r.reason))].join(', ')}</div>
              {g.filter((r) => r.details).map((r) => <div key={r.id} className="muted">“{r.details}”</div>)}
              <form className="row" action={resolveReport.bind(null, first.id, true)}>
                <input name="notes" placeholder="Decision notes (shared with the uploader)" required style={{ flex: 1 }} />
                <button className="btn danger">Remove content</button>
                <button className="btn secondary" formAction={resolveReport.bind(null, first.id, false)}>Dismiss</button>
              </form>
            </div>
          );
        })}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Open appeals ({appeals?.length ?? 0})</h2>
        {(appeals ?? []).map((a) => (
          <div key={a.id} className="card stack" style={{ background: 'var(--surface-2)' }}>
            <strong>{a.target_type}: {video.get(a.target_id)?.caption ?? a.target_id}</strong>
            <div>“{a.body}”</div>
            <form className="row" action={decideAppeal.bind(null, a.id, true)}>
              <input name="notes" placeholder="Decision (sent to the appellant)" required style={{ flex: 1 }} />
              <button className="btn">Overturn (restore)</button>
              <button className="btn secondary" formAction={decideAppeal.bind(null, a.id, false)}>Uphold</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
