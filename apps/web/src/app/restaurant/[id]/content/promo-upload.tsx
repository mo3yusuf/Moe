'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

const MAX_BYTES = 500 * 1024 * 1024;

/** Restaurant uploads an existing promo video. File goes browser → private storage; then sent for moderation. */
export function PromoUpload({ restaurantId, items }: { restaurantId: string; items: { id: string; name: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [itemId, setItemId] = useState('');
  const [rights, setRights] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readDuration(f: File): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { resolve(Math.round(v.duration * 1000)); URL.revokeObjectURL(v.src); };
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(f);
    });
  }

  async function submit() {
    if (!file) return;
    if (!['video/mp4', 'video/quicktime'].includes(file.type)) return setStatus('Use an MP4 or MOV file.');
    if (file.size > MAX_BYTES) return setStatus('Videos must be under 500 MB.');
    const durationMs = await readDuration(file);
    if (durationMs < 3000 || durationMs > 180000) return setStatus('Videos must be between 3 seconds and 3 minutes.');
    setBusy(true);
    setStatus('Creating video…');
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return setStatus('Please sign in again.'); }
    const { data: video, error } = await supabase.from('videos')
      .insert({ uploader_id: user.id, source: 'restaurant', restaurant_id: restaurantId, caption: caption.slice(0, 500) || null, duration_ms: durationMs })
      .select('id').single();
    if (error || !video) { setBusy(false); return setStatus(`Failed: ${error?.message}`); }
    setStatus('Uploading…');
    const path = `${user.id}/${video.id}.${file.type === 'video/mp4' ? 'mp4' : 'mov'}`;
    const up = await supabase.storage.from('video-uploads').upload(path, file, { contentType: file.type });
    if (up.error) { setBusy(false); return setStatus(`Upload failed: ${up.error.message}`); }
    const done = await supabase.from('videos').update({ storage_path: path, status: 'pending_review', rights_attested_at: new Date().toISOString() }).eq('id', video.id);
    if (done.error) { setBusy(false); return setStatus(`Failed: ${done.error.message}`); }
    if (itemId) await supabase.from('video_menu_items').insert({ video_id: video.id, menu_item_id: itemId, restaurant_id: restaurantId });
    setBusy(false);
    setStatus('Uploaded — CRAVE will review it shortly (usually within one business day).');
    setFile(null);
  }

  return (
    <div className="stack">
      <label>Video file (MP4/MOV, 3 s – 3 min)<input type="file" accept="video/mp4,video/quicktime" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label>Caption<input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} /></label>
      <label>Featured menu item<select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        <option value="">None</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select></label>
      <label style={{ flexDirection: 'row', gap: 8, alignItems: 'center', color: 'var(--text)' }}>
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} style={{ width: 18, minHeight: 18 }} />
        I own or have licensed all rights to this video, including any music, people and footage shown.
      </label>
      {status ? <p className="muted" role="status">{status}</p> : null}
      <div><button className="btn" disabled={!file || !rights || busy} onClick={submit}>{busy ? 'Working…' : 'Upload for review'}</button></div>
    </div>
  );
}
