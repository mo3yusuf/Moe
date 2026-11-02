import { apiFetch } from '@/lib/api';
import { moderate } from './actions';
import { VideoPreview } from '@/components/VideoPreview';

interface Item {
  id: string; caption: string | null; source: string; isSponsored: boolean; sponsorDisclosure: string | null; createdAt: string;
  durationMs: number | null; previewUrl: string | null; tags: { menuItemName: string; restaurantName: string; status: string }[]; openReports: number;
  thumbnailUrl?: string | null; processing?: boolean;
}

export default async function VideoModeration() {
  let items: Item[] = [];
  let error: string | null = null;
  try { items = (await apiFetch<{ items: Item[] }>('/v1/admin/videos?status=pending_review')).items; } catch (e) { error = (e as Error).message; }
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Video moderation</h1>
      <p className="muted" style={{ margin: 0 }}>Check: real food from the tagged restaurant, no misleading claims, sponsored content disclosed, no unlicensed music or people filmed without consent, community guidelines.</p>
      {error ? <p className="error">Could not reach the CRAVE API: {error}</p> : null}
      {!error && items.length === 0 ? <p className="muted">No videos awaiting review.</p> : null}
      <div className="grid">
        {items.map((v) => (
          <div key={v.id} className="card stack">
            {v.processing ? <p className="muted">Still processing on Mux — refresh in a minute.</p>
              : v.previewUrl ? <VideoPreview src={v.previewUrl} poster={v.thumbnailUrl} /> : <p className="muted">File not uploaded yet</p>}
            <div><strong>{v.caption ?? 'No caption'}</strong></div>
            <div className="muted">{v.source} · {v.durationMs ? `${Math.round(v.durationMs / 1000)}s` : ''} · {new Date(v.createdAt).toLocaleString('en-AU')}</div>
            {v.isSponsored ? <span className="badge warn">Sponsored: {v.sponsorDisclosure}</span> : null}
            {v.openReports ? <span className="badge bad">{v.openReports} open report(s)</span> : null}
            {v.tags.map((t) => <div key={t.menuItemName} className="muted">Tag: {t.menuItemName} @ {t.restaurantName} ({t.status})</div>)}
            <form action={moderate.bind(null, v.id, 'publish')}><button className="btn" disabled={v.processing}>Publish</button></form>
            <form className="row" action={moderate.bind(null, v.id, 'reject')}>
              <input name="notes" placeholder="Reason (sent to uploader)" required style={{ flex: 1 }} /><button className="btn danger">Reject</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
